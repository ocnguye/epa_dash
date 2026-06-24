/**
 * Adjusted EPA Score Calculator
 *
 * Implements the adjusted EPA formula from:
 * "Adjusted EPA Score Proposal (Detailed Version)" — Oanh Nguyen, March 18, 2026
 *
 * The adjusted score incorporates four components:
 *   1. Raw EPA score      (Eraw)
 *   2. Procedure difficulty weight  (Pw)
 *   3. Case-specific complexity adjustment  (Ccase)
 *   4. Evaluator bias adjustment  (Zeval)
 *
 * Final: Eadj = clip(Eraw + Pw + Ccase + Zeval, 1, 5)
 *
 * Multi-attending support
 * -----------------------
 * When more than one attending co-signs an EPA score the proposal's intent is
 * that the score reflects the *collective* judgment of the panel.  We therefore
 * compute a z-score for each attending independently and use the **average** of
 * those z-scores as the panel-level bias correction.  This is mathematically
 * equivalent to pooling the attendings' historical distributions and asking
 * "how does this raw score sit relative to the panel's typical behaviour?"
 *
 * If evaluator stats are unavailable for some attendings (e.g. new evaluators
 * with no history), those attendings are simply excluded from the average
 * rather than defaulting to 0, which would dilute the signal from evaluators
 * whose stats we do have.  If stats are unavailable for ALL attendings the
 * evaluator adjustment defaults to 0.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Procedure difficulty category on a 1–5 scale (radiologist-vetted lookup). */
export type ProcedureDifficultyCategory = 1 | 2 | 3 | 4 | 5;

/** Historical scoring statistics for a single evaluator. */
export interface EvaluatorStats {
  /** Database user_id of the attending. */
  userId: number;
  /** Historical mean EPA score given by this evaluator. */
  mean: number;
  /** Historical standard deviation of EPA scores given by this evaluator. */
  stdDev: number;
}

/**
 * All inputs required to compute an adjusted EPA score.
 *
 * `evaluators` replaces the old single evaluatorMean/evaluatorStdDev fields.
 * Pass one entry per attending on the case — the formula handles panels of
 * any size (including the common single-attending case).
 */
export interface AdjustedEPAInput {
  /** Raw EPA score assigned by the evaluator(s) (1–5). */
  rawScore: number;

  /** Baseline procedure difficulty category (1–5). */
  procedureDifficulty: ProcedureDifficultyCategory;

  /**
   * Fluoroscopy time for this specific case.
   * Units must match tMedianP. Pass null/undefined when unavailable.
   */
  tCase?: number | null;

  /**
   * Median fluoroscopy time for this procedure type.
   * Pass null/undefined when unavailable.
   */
  tMedianP?: number | null;

  /**
   * Radiation dose for this specific case.
   * Pass null/undefined when unavailable.
   */
  dCase?: number | null;

  /**
   * Median radiation dose for this procedure type.
   * Pass null/undefined when unavailable.
   */
  dMedianP?: number | null;

  /**
   * One entry per attending who participated in the evaluation.
   * The array may contain one or many attendings.
   * Attendings with no historical stats should be omitted from this array
   * (the API layer is responsible for filtering them out before calling here).
   */
  evaluators: EvaluatorStats[];
}

/**
 * Design parameters that control the relative weight of each adjustment.
 * Per the proposal these should be complementary and sum to 1
 * (e.g., 0.5 / 0.25 / 0.25).
 */
export interface DesignParameters {
  /** Maximum contribution of procedure difficulty.  Proposal default: 0.5 */
  wDiff: number;
  /** Maximum contribution of case-specific complexity.  Proposal default: 0.25 */
  wC: number;
  /** Maximum contribution of evaluator bias correction.  Proposal default: 0.25 */
  wZ: number;
}

/** Default design parameters from the proposal. */
export const DEFAULT_DESIGN_PARAMETERS: DesignParameters = {
  wDiff: 0.5,
  wC: 0.25,
  wZ: 0.25,
};

/** Per-evaluator breakdown included in the result for transparency. */
export interface EvaluatorAdjustmentDetail {
  userId: number;
  zScore: number;
  /** Individual clipped adjustment before panel averaging. */
  individualAdjustment: number;
}

/** Full breakdown of every intermediate value for display / audit. */
export interface AdjustedEPAResult {
  /** Final adjusted EPA score, clipped to [1, 5]. */
  adjustedScore: number;

  /** Step 1 — procedure difficulty weight adjustment (Pw). */
  procedureDifficultyWeight: number;

  /** Relative fluoroscopy time ratio (Rtime), or null if unavailable. */
  rTime: number | null;

  /** Relative radiation dose ratio (Rdose), or null if unavailable. */
  rDose: number | null;

  /** Combined case-specific complexity ratio (Rratio). */
  rRatio: number;

  /** Step 2 — case-specific complexity adjustment (Ccase), clipped to [0, wC]. */
  complexityAdjustment: number;

  /**
   * Per-evaluator z-score details.
   * Contains one entry for each attending whose stats were available.
   */
  evaluatorDetails: EvaluatorAdjustmentDetail[];

  /**
   * Step 3 — panel-level evaluator bias adjustment (Zeval).
   * Average of individual clipped adjustments, then re-clipped to [-wZ, +wZ].
   */
  evaluatorAdjustment: number;

  /** The original raw score passed in. */
  rawScore: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clip(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// ---------------------------------------------------------------------------
// Step implementations (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Step 1 — Baseline Procedure Difficulty Weight Adjustment.
 *
 * Pw = wDiff * (Pdiff - 1) / 4
 */
export function computeProcedureDifficultyWeight(
    difficulty: ProcedureDifficultyCategory,
    wDiff: number
): number {
    const raw = wDiff * ((difficulty - 1) / 4);
    return Math.max(0, raw); // explicit floor — difficulty is never a penalty
}

/**
 * Step 2 — Case-Specific Complexity Ratios & Adjustment.
 *
 * Computes Rtime, Rdose, Rratio, and the clipped Ccase.
 * Returns rRatio = 1 (no adjustment) when neither metric is available.
 */
export function computeComplexityAdjustment(
  tCase: number | null | undefined,
  tMedianP: number | null | undefined,
  dCase: number | null | undefined,
  dMedianP: number | null | undefined,
  wC: number
): {
  rTime: number | null;
  rDose: number | null;
  rRatio: number;
  complexityAdjustment: number;
} {
  const hasTime = tCase != null && tMedianP != null && tMedianP !== 0;
  const hasDose = dCase != null && dMedianP != null && dMedianP !== 0;

  const rTime: number | null = hasTime ? tCase! / tMedianP! : null;
  const rDose: number | null = hasDose ? dCase! / dMedianP! : null;

  let rRatio: number;
  if (hasTime && hasDose) {
    rRatio = (rTime! + rDose!) / 2;
  } else if (hasTime) {
    rRatio = rTime!;
  } else if (hasDose) {
    rRatio = rDose!;
  } else {
    rRatio = 1;
  }

  // Negative deviations (easier than median) do not decrease the EPA score.
  const complexityAdjustment = clip(wC * (rRatio - 1), 0, wC);

  return { rTime, rDose, rRatio, complexityAdjustment };
}

/**
 * Step 3 — Multi-Evaluator Bias Adjustment.
 *
 * For each attending with valid stats:
 *   Z_i     = (Eraw - µ_i) / σ_i
 *   Zadj_i  = clip(wZ * Z_i, -wZ, +wZ)
 *
 * Panel adjustment = average(Zadj_i), re-clipped to [-wZ, +wZ].
 *
 * This is the ONLY component that can produce a negative adjustment.
 * Pw (difficulty) and Ccase (complexity) are both floored at 0.
 * Zeval is clipped to [-wZ, +wZ], so the maximum downward correction
 * is -0.25 EPA points (with default parameters).
 */
export function computeEvaluatorAdjustmentMulti(
  rawScore: number,
  evaluators: EvaluatorStats[],
  wZ: number
): {
  evaluatorDetails: EvaluatorAdjustmentDetail[];
  evaluatorAdjustment: number;
} {
  const details: EvaluatorAdjustmentDetail[] = [];

  for (const ev of evaluators) {
    if (ev.stdDev === 0) continue; // skip — no variance means no bias signal

    const zScore = (rawScore - ev.mean) / ev.stdDev;
    const individualAdjustment = clip(wZ * zScore, -wZ, wZ);

    details.push({ userId: ev.userId, zScore, individualAdjustment });
  }

  if (details.length === 0) {
    return { evaluatorDetails: [], evaluatorAdjustment: 0 };
  }

  const avgAdjustment =
    details.reduce((sum, d) => sum + d.individualAdjustment, 0) / details.length;

  // Re-clip the panel average to ensure it stays within bounds
  const evaluatorAdjustment = clip(avgAdjustment, -wZ, wZ);

  return { evaluatorDetails: details, evaluatorAdjustment };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Computes the full adjusted EPA score from a raw evaluation record.
 *
 * @example — single attending
 * ```ts
 * computeAdjustedEPA({
 *   rawScore: 4,
 *   procedureDifficulty: 1,
 *   tCase: 12, tMedianP: 8,
 *   dCase: 70, dMedianP: 50,
 *   evaluators: [{ userId: 7, mean: 3.8, stdDev: 0.6 }],
 * });
 * // adjustedScore ≈ 4.20
 * ```
 *
 * @example — two co-attending panel
 * ```ts
 * computeAdjustedEPA({
 *   rawScore: 4,
 *   procedureDifficulty: 4,
 *   tCase: 11, tMedianP: 10,
 *   dCase: 110, dMedianP: 100,
 *   evaluators: [
 *     { userId: 3, mean: 4.2, stdDev: 0.5 },
 *     { userId: 9, mean: 3.9, stdDev: 0.4 },
 *   ],
 * });
 * ```
 */
export function computeAdjustedEPA(
  input: AdjustedEPAInput,
  params: DesignParameters = DEFAULT_DESIGN_PARAMETERS
): AdjustedEPAResult {
  const {
    rawScore,
    procedureDifficulty,
    tCase,
    tMedianP,
    dCase,
    dMedianP,
    evaluators,
  } = input;
  const { wDiff, wC, wZ } = params;

  // Step 1
  const procedureDifficultyWeight = computeProcedureDifficultyWeight(
    procedureDifficulty,
    wDiff
  );

  // Step 2
  const { rTime, rDose, rRatio, complexityAdjustment } =
    computeComplexityAdjustment(tCase, tMedianP, dCase, dMedianP, wC);

  // Step 3 — handles any number of attendings
  const { evaluatorDetails, evaluatorAdjustment } =
    computeEvaluatorAdjustmentMulti(rawScore, evaluators, wZ);

  // Step 4 — Final score
  const adjustedScore = clip(
    rawScore + procedureDifficultyWeight + complexityAdjustment + evaluatorAdjustment,
    1,
    5
  );

  return {
    adjustedScore,
    procedureDifficultyWeight,
    rTime,
    rDose,
    rRatio,
    complexityAdjustment,
    evaluatorDetails,
    evaluatorAdjustment,
    rawScore,
  };
}

/**
 * Convenience helper for computing adjusted scores in bulk
 * (e.g., populating a dashboard table from a list of raw EPA records).
 */
export function computeAdjustedEPABatch(
  inputs: AdjustedEPAInput[],
  params: DesignParameters = DEFAULT_DESIGN_PARAMETERS
): AdjustedEPAResult[] {
  return inputs.map((input) => computeAdjustedEPA(input, params));
}