/**
 * adjustedEpa.ts
 *
 * Computes adjusted EPA scores per EPA_Adjustment_Proposal_V1.
 *
 * Formula (4 steps):
 *   1. Pw     = wDiff * (Pdiff - 1) / 4
 *   2. Ccase  = clip(wc * (Rratio - 1), 0, +0.25)
 *   3. Zeval  = clip(wz * Z, -0.25, +0.25)
 *   4. Eadj   = clip(Eraw + Pw + Ccase + Zeval, 1, 5)
 *
 * ── Difficulty category source ────────────────────────────────────────────────
 *
 * The previous PROCEDURE_DIFFICULTY_MAP (hardcoded TS object) has been removed.
 * Difficulty is now sourced from proc_types.complexity (tinyint 1–5) via the
 * /api/adjustedEpaStats route, which returns a procedureMedians map keyed by
 * proc_code. Pass the complexity value from that map into AdjustedEpaInput.
 *
 * ── Metric availability ───────────────────────────────────────────────────────
 *
 * Fluoroscopy procedures  → fluoroscopyTime + radiationDose  (Rratio = avg)
 * CT procedures           → radiationDose only               (Rratio = Rdose)
 * Neither available       → Rratio defaults to 1             (Ccase = 0)
 *
 * This is handled transparently by computeCcase() — callers do not need to
 * branch on scan type; simply pass whatever values are available and leave
 * the rest null/undefined.
 *
 * None of these values are persisted to the DB.
 */

// ─── Design parameters ────────────────────────────────────────────────────────

export interface DesignParameters {
    /** Weight of procedure difficulty contribution. Default 0.5. */
    wDiff: number;
    /** Weight of case-specific complexity adjustment. Default 0.25. */
    wc: number;
    /** Weight of evaluator bias adjustment. Default 0.25. */
    wz: number;
}

export const DEFAULT_DESIGN_PARAMS: DesignParameters = {
    wDiff: 0.5,
    wc:    0.25,
    wz:    0.25,
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type DifficultyCategory = 1 | 2 | 3 | 4 | 5;

export interface AdjustedEpaInput {
    /** Raw EPA score from the evaluator (integer 1–5). */
    eRaw: number;

    /**
     * Radiologist-vetted difficulty category from proc_types.complexity.
     * null → procedure not yet rated; Pw will be 0.
     */
    complexity: DifficultyCategory | null;

    // ── Case-specific complexity metrics ─────────────────────────────────────
    // Pass whatever columns are non-null for this report. computeCcase() will
    // use whichever are available and ignore the rest.

    /** This case's fluoroscopy time (fluoroscopy_time_minutes). null for CT. */
    fluoroscopyTime?: number | null;
    /** Median fluoroscopy time for this proc_code across all reports. null for CT procedures. */
    fluoroscopyTimeMedian?: number | null;

    /** This case's radiation dose (fluoroscopy_dose_value). Available for CT and fluoro. */
    radiationDose?: number | null;
    /** Median radiation dose for this proc_code across all reports. */
    radiationDoseMedian?: number | null;

    // ── Evaluator statistics ──────────────────────────────────────────────────
    // Source: /api/adjustedEpaStats → evaluatorStats[attending_user_id]
    // Pass stdDev = 0 when the attending has no qualifying scoring history;
    // computeZeval() short-circuits to Zeval = 0 in that case.

    evaluatorMean: number;
    evaluatorStdDev: number;
}

/** Full intermediate breakdown — use for tooltips, audit logs, or debug panels. */
export interface AdjustedEpaResult {
    eRaw: number;
    complexity: DifficultyCategory | null;
    /** Step 1: procedure difficulty weight */
    pw: number;
    /** Rtime (null when fluoro time unavailable — e.g. CT procedures) */
    rTime: number | null;
    /** Rdose (null when dose unavailable) */
    rDose: number | null;
    /** Combined case complexity ratio */
    rRatio: number;
    /** Step 2: case-specific complexity adjustment */
    cCase: number;
    /** Raw evaluator z-score (null when stdDev = 0 or < 2 scores) */
    zScore: number | null;
    /** Step 3: evaluator bias adjustment */
    zEval: number;
    /** Step 4: final adjusted score clipped to [1, 5] */
    eAdj: number;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function clip(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

// ─── Step 1: Procedure difficulty weight ──────────────────────────────────────

/**
 * Pw = wDiff * (Pdiff - 1) / 4
 *
 * complexity null → Pw = 0 (no penalty, no bonus; procedure unrated).
 */
export function computePw(
    complexity: DifficultyCategory | null,
    params: DesignParameters = DEFAULT_DESIGN_PARAMS
): number {
    if (complexity === null) return 0;
    return params.wDiff * ((complexity - 1) / 4);
}

// ─── Step 2: Case-specific complexity adjustment ──────────────────────────────

/**
 * Computes Rtime, Rdose, Rratio, and Ccase.
 *
 * Metric availability rules (mirroring the proposal):
 *   Both available  → Rratio = (Rtime + Rdose) / 2
 *   Time only       → Rratio = Rtime   (fluoro procedure, dose not recorded)
 *   Dose only       → Rratio = Rdose   (CT procedure, or dose-only fluoro)
 *   Neither         → Rratio = 1       (no adjustment; Ccase = 0)
 *
 * Negative deviations (case easier than median) are floored at 0 — they do
 * not decrease the EPA score per the proposal spec.
 */
export function computeCcase(
    input: Pick<
        AdjustedEpaInput,
        | 'fluoroscopyTime'
        | 'fluoroscopyTimeMedian'
        | 'radiationDose'
        | 'radiationDoseMedian'
    >,
    params: DesignParameters = DEFAULT_DESIGN_PARAMS
): { rTime: number | null; rDose: number | null; rRatio: number; cCase: number } {
    const hasTime =
        input.fluoroscopyTime != null &&
        input.fluoroscopyTimeMedian != null &&
        input.fluoroscopyTimeMedian > 0;

    const hasDose =
        input.radiationDose != null &&
        input.radiationDoseMedian != null &&
        input.radiationDoseMedian > 0;

    const rTime = hasTime ? input.fluoroscopyTime! / input.fluoroscopyTimeMedian! : null;
    const rDose = hasDose ? input.radiationDose!   / input.radiationDoseMedian!   : null;

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

    const cCase = clip(params.wc * (rRatio - 1), 0, 0.25);
    return { rTime, rDose, rRatio, cCase };
}

// ─── Step 3: Evaluator bias adjustment ───────────────────────────────────────

/**
 * Z     = (Eraw - µe) / σe
 * Zeval = clip(wz * Z, -0.25, +0.25)
 *
 * Returns zScore = null, zEval = 0 when stdDev ≤ 0 (attending excluded from
 * stats pool due to insufficient or uniform scoring history).
 */
export function computeZeval(
    eRaw: number,
    evaluatorMean: number,
    evaluatorStdDev: number,
    params: DesignParameters = DEFAULT_DESIGN_PARAMS
): { zScore: number | null; zEval: number } {
    if (!evaluatorStdDev || evaluatorStdDev <= 0) {
        return { zScore: null, zEval: 0 };
    }
    const zScore = (eRaw - evaluatorMean) / evaluatorStdDev;
    const zEval  = clip(params.wz * zScore, -0.25, 0.25);
    return { zScore, zEval };
}

// ─── Step 4: Final score ──────────────────────────────────────────────────────

export function computeFinalEadj(
    eRaw: number,
    pw: number,
    cCase: number,
    zEval: number
): number {
    return clip(eRaw + pw + cCase + zEval, 1, 5);
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Compute a fully-detailed adjusted EPA score for a single EPA row.
 *
 * @example
 * ```ts
 * // Fetch lookup maps once per page load
 * const { evaluatorStats, procedureMedians } = await fetch('/api/adjustedEpaStats').then(r => r.json());
 *
 * // For each EPA row from the DB:
 * const procKey  = row.ProcedureCodeList?.toLowerCase() ?? '';
 * const procData = procedureMedians[procKey];
 * const evalData = evaluatorStats[row.attending_user_id];
 *
 * const result = computeAdjustedEpa({
 *   eRaw:                  row.epa_score,
 *   complexity:            procData?.complexity ?? null,
 *   fluoroscopyTime:       row.fluoroscopy_time_minutes,
 *   fluoroscopyTimeMedian: procData?.fluoroTimeMedian ?? null,
 *   radiationDose:         row.fluoroscopy_dose_value,
 *   radiationDoseMedian:   procData?.radiationDoseMedian ?? null,
 *   evaluatorMean:         evalData?.mean    ?? 0,
 *   evaluatorStdDev:       evalData?.stdDev  ?? 0,
 * });
 *
 * // result.eAdj  → display value
 * // result.*     → full breakdown for tooltip / audit
 * ```
 */
export function computeAdjustedEpa(
    input: AdjustedEpaInput,
    params: DesignParameters = DEFAULT_DESIGN_PARAMS
): AdjustedEpaResult {
    const pw                        = computePw(input.complexity, params);
    const { rTime, rDose, rRatio, cCase } = computeCcase(input, params);
    const { zScore, zEval }         = computeZeval(
        input.eRaw,
        input.evaluatorMean,
        input.evaluatorStdDev,
        params
    );
    const eAdj = computeFinalEadj(input.eRaw, pw, cCase, zEval);

    return {
        eRaw:       input.eRaw,
        complexity: input.complexity,
        pw,
        rTime,
        rDose,
        rRatio,
        cCase,
        zScore,
        zEval,
        eAdj,
    };
}

// ─── Batch helper ─────────────────────────────────────────────────────────────

export interface EpaRow {
    score:                  number;
    complexity:             DifficultyCategory | null;
    fluoroscopyTime?:       number | null;
    fluoroscopyTimeMedian?: number | null;
    radiationDose?:         number | null;
    radiationDoseMedian?:   number | null;
    evaluatorMean:          number;
    evaluatorStdDev:        number;
    [key: string]: unknown;
}

/**
 * Batch-compute adjusted EPA scores for an array of rows (e.g. a trainee's
 * full procedure history). Returns each row merged with its AdjustedEpaResult.
 */
export function computeAdjustedEpaBatch(
    rows: EpaRow[],
    params: DesignParameters = DEFAULT_DESIGN_PARAMS
): (EpaRow & AdjustedEpaResult)[] {
    return rows.map(row => ({
        ...row,
        ...computeAdjustedEpa(
            {
                eRaw:                  row.score,
                complexity:            row.complexity,
                fluoroscopyTime:       row.fluoroscopyTime,
                fluoroscopyTimeMedian: row.fluoroscopyTimeMedian,
                radiationDose:         row.radiationDose,
                radiationDoseMedian:   row.radiationDoseMedian,
                evaluatorMean:         row.evaluatorMean,
                evaluatorStdDev:       row.evaluatorStdDev,
            },
            params
        ),
    }));
}