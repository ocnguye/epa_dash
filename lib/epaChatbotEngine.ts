// Pure matching / aggregation logic — no React, no fetch. Easy to unit test.

export interface TraineeListItem {
  user_id: number;
  username: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  pgy: number | null;
  role: string;
  avg_epa: number;
  report_count: number;
}

export interface ProcedureRecord {
  report_id: number;
  create_date: string;
  proc_desc: string | null;
  proc_code: string | null;
  oepa: number | null;
  complexity?: string | null;
  // present only when the request included `q`: 1 if proc_desc/proc_code matched,
  // 0 if the row only matched via ContentText full-text search
  desc_match?: number;
}

export interface TraineeDetail {
  user: {
    user_id: number;
    username: string;
    first_name: string;
    last_name: string;
    preferred_name: string | null;
    pgy: number | null;
    role: string;
  };
  procedures: ProcedureRecord[];
  stats: {
    avg_epa: number;
    procedures: number;
    feedback_requested: number;
    feedback_discussed: number;
    total_reports: number;
  };
}

export interface CohortProcedureItem {
  desc: string;
  code: string;
  avg_epa: number;
  count: number;
}

// ---------------- text utils ----------------

export function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(s: string): string[] {
  return normalize(s).split(' ').filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

// ---------------- trainee resolution ----------------
//
// Last name is the high-priority anchor — same role it plays as the
// `knownLastNames` Set in the EPA-extraction script. We look for an exact
// last-name token (or short multi-word last name) in the query first. Once
// found, whatever's left over is checked against the trainee's "given name"
// pool, which is their first_name plus every individual word of their
// preferred_name (since a preferred name may be a single nickname like
// "Hanssen" or a full first+last alias like "Bobby Lee" — splitting it into
// words lets either form match without special-casing).
//
// If the last name matches more than one trainee, the given-name leftover
// is used to try to pick the right one automatically; only when that's
// genuinely ambiguous do we surface a "did you mean" prompt.

export interface TraineeMatch {
  trainee: TraineeListItem;
  score: number;
  matchedPhrase: string;
}

function displayName(t: TraineeListItem): string {
  return `${t.first_name} ${t.last_name}`;
}

const GIVEN_NAME_FUZZY_THRESHOLD = 0.72; // per-token similarity to count as a given-name match
const LAST_NAME_FUZZY_THRESHOLD = 0.82;  // stricter — last name is the anchor, typos only
const DECISIVE_MARGIN = 0.2;             // how much better the top candidate must score to auto-resolve
const MAX_LAST_NAME_SPAN = 3;            // tokens to consider for multi-word last names (e.g. "Van Der Berg")

// Every word that could stand in for this trainee's given name: their real
// first name, plus each word of their preferred name (which may itself be
// one word or a full first+last alias).
function givenNameTokens(t: TraineeListItem): string[] {
  const pool = new Set<string>();
  if (t.first_name) pool.add(normalize(t.first_name));
  if (t.preferred_name) for (const w of tokenize(t.preferred_name)) pool.add(w);
  return Array.from(pool).filter(Boolean);
}

function buildLastNameIndex(trainees: TraineeListItem[]): Map<string, TraineeListItem[]> {
  const idx = new Map<string, TraineeListItem[]>();
  for (const t of trainees) {
    const key = normalize(t.last_name);
    if (!key) continue;
    const list = idx.get(key);
    if (list) list.push(t); else idx.set(key, [t]);
  }
  return idx;
}

interface LastNameAnchor {
  lastNameKey: string;
  tokenStart: number;
  tokenEnd: number; // exclusive
  trainees: TraineeListItem[];
}

// Exact match only (after normalization). Deliberately not fuzzy — this is
// the anchor, so it should never get hijacked by a procedure word that
// merely resembles a surname. Typo'd last names get a second chance below.
function findExactLastNameAnchor(tokens: string[], index: Map<string, TraineeListItem[]>): LastNameAnchor | null {
  const maxSize = Math.min(MAX_LAST_NAME_SPAN, tokens.length);
  for (let size = maxSize; size >= 1; size--) {
    for (let i = 0; i + size <= tokens.length; i++) {
      const phrase = tokens.slice(i, i + size).join(' ');
      const trainees = index.get(phrase);
      if (trainees) return { lastNameKey: phrase, tokenStart: i, tokenEnd: i + size, trainees };
    }
  }
  return null;
}

// Single-token fuzzy fallback for a misspelled last name. Picks the single
// best (token, last-name) pairing across the whole query rather than just
// the first one that clears the threshold.
function findFuzzyLastNameAnchor(tokens: string[], index: Map<string, TraineeListItem[]>): LastNameAnchor | null {
  let best: { key: string; pos: number; score: number } | null = null;
  for (let i = 0; i < tokens.length; i++) {
    for (const key of index.keys()) {
      const score = similarity(tokens[i], key);
      if (score >= LAST_NAME_FUZZY_THRESHOLD && (!best || score > best.score)) {
        best = { key, pos: i, score };
      }
    }
  }
  if (!best) return null;
  return { lastNameKey: best.key, tokenStart: best.pos, tokenEnd: best.pos + 1, trainees: index.get(best.key)! };
}

// How well do the leftover (non-last-name) tokens match this trainee's
// given-name pool? Used both to consume given-name tokens out of the
// procedure remainder, and to auto-resolve when a last name is shared.
function scoreGivenNameOverlap(trainee: TraineeListItem, leftover: string[]): { score: number; matchedTokens: string[] } {
  const pool = givenNameTokens(trainee);
  if (pool.length === 0 || leftover.length === 0) return { score: 0, matchedTokens: [] };

  let score = 0;
  const matchedTokens: string[] = [];
  for (const tok of leftover) {
    let tokScore = 0;
    for (const g of pool) tokScore = Math.max(tokScore, g === tok ? 1 : similarity(g, tok));
    if (tokScore >= GIVEN_NAME_FUZZY_THRESHOLD) {
      score += tokScore;
      matchedTokens.push(tok);
    }
  }
  return { score, matchedTokens };
}

function resolveWithLastNameAnchor(anchor: LastNameAnchor, tokens: string[]): TraineeResolution {
  const leftover = tokens.filter((_, i) => i < anchor.tokenStart || i >= anchor.tokenEnd);

  if (anchor.trainees.length === 1) {
    const trainee = anchor.trainees[0];
    const { matchedTokens } = scoreGivenNameOverlap(trainee, leftover);
    const remainder = leftover.filter(t => !matchedTokens.includes(t));
    return { trainee, remainder: remainder.join(' '), ambiguous: [] };
  }

  // Multiple trainees share this last name. Score each by how well any
  // leftover token matches their given-name pool — e.g. "li" shared by two
  // trainees, but only one of them goes by "Hanssen" — and only resolve
  // automatically when there's a clear winner.
  const scored = anchor.trainees
    .map(t => ({ trainee: t, ...scoreGivenNameOverlap(t, leftover) }))
    .sort((a, b) => b.score - a.score);

  const [top, runnerUp] = scored;
  const decisive = top.score > 0 && (!runnerUp || top.score - runnerUp.score >= DECISIVE_MARGIN);

  if (decisive) {
    const remainder = leftover.filter(t => !top.matchedTokens.includes(t));
    return { trainee: top.trainee, remainder: remainder.join(' '), ambiguous: [] };
  }

  // Genuinely ambiguous — prompt, scoped to only the trainees sharing this
  // last name (never the whole roster).
  const pool = top.score > 0
    ? scored.filter(s => s.score >= top.score - DECISIVE_MARGIN)
    : scored;
  return {
    trainee: null,
    remainder: leftover.join(' '),
    ambiguous: pool.slice(0, 4).map(s => ({ trainee: s.trainee, score: s.score, matchedPhrase: anchor.lastNameKey })),
  };
}

// ---- whole-roster fuzzy fallback ----
// Reached only when no token in the query matches any trainee's last name,
// exactly or by typo-tolerant fuzzy match — e.g. a preferred-name-only
// query, or a name far enough off that the anchor passes above miss it.

function traineeSearchableFields(t: TraineeListItem): string[] {
  const namePieces = new Set<string>();
  if (t.first_name) namePieces.add(normalize(t.first_name));
  if (t.last_name) namePieces.add(normalize(t.last_name));
  if (t.preferred_name) for (const w of tokenize(t.preferred_name)) namePieces.add(w);

  const fields = new Set<string>(namePieces);
  for (const a of namePieces) for (const b of namePieces) if (a !== b) fields.add(`${a} ${b}`);
  if (t.username) fields.add(normalize(t.username));
  return Array.from(fields).filter(Boolean);
}

function findTraineeMatchesFuzzy(query: string, trainees: TraineeListItem[]): TraineeMatch[] {
  const tokens = tokenize(query);
  const candidates: TraineeMatch[] = [];

  for (let size = Math.min(3, tokens.length); size >= 1; size--) {
    for (let i = 0; i + size <= tokens.length; i++) {
      const phrase = tokens.slice(i, i + size).join(' ');
      if (phrase.length < 2) continue;
      for (const t of trainees) {
        let best = 0;
        for (const field of traineeSearchableFields(t)) {
          if (field === phrase) { best = Math.max(best, 1); continue; }
          if (field.includes(phrase) || phrase.includes(field)) { best = Math.max(best, 0.9); continue; }
          best = Math.max(best, similarity(field, phrase));
        }
        if (best >= GIVEN_NAME_FUZZY_THRESHOLD) candidates.push({ trainee: t, score: best, matchedPhrase: phrase });
      }
    }
  }

  const byTrainee = new Map<number, TraineeMatch>();
  for (const c of candidates) {
    const existing = byTrainee.get(c.trainee.user_id);
    const better = !existing || c.score > existing.score ||
      (c.score === existing.score && tokenize(c.matchedPhrase).length > tokenize(existing.matchedPhrase).length);
    if (better) byTrainee.set(c.trainee.user_id, c);
  }
  return Array.from(byTrainee.values()).sort((a, b) => b.score - a.score);
}

function resolveByFuzzyWholeRoster(query: string, trainees: TraineeListItem[]): TraineeResolution {
  const matches = findTraineeMatchesFuzzy(query, trainees);
  if (matches.length === 0) return { trainee: null, remainder: query, ambiguous: [] };

  const top = matches[0];
  const close = matches.filter(m => m.trainee.user_id !== top.trainee.user_id && m.score >= top.score - 0.08);
  if (close.length > 0) return { trainee: null, remainder: query, ambiguous: [top, ...close].slice(0, 4) };

  const matchedTokens = tokenize(top.matchedPhrase);
  const remainderTokens = tokenize(query).filter(t => !matchedTokens.includes(t));
  return { trainee: top.trainee, remainder: remainderTokens.join(' '), ambiguous: [] };
}

export interface TraineeResolution {
  trainee: TraineeListItem | null;
  remainder: string;
  ambiguous: TraineeMatch[];
}

export function resolveTrainee(query: string, trainees: TraineeListItem[]): TraineeResolution {
  const tokens = tokenize(query);
  if (tokens.length === 0) return { trainee: null, remainder: query, ambiguous: [] };

  const lastNameIndex = buildLastNameIndex(trainees);

  const exactAnchor = findExactLastNameAnchor(tokens, lastNameIndex);
  if (exactAnchor) return resolveWithLastNameAnchor(exactAnchor, tokens);

  const fuzzyAnchor = findFuzzyLastNameAnchor(tokens, lastNameIndex);
  if (fuzzyAnchor) return resolveWithLastNameAnchor(fuzzyAnchor, tokens);

  return resolveByFuzzyWholeRoster(query, trainees);
}

// ---------------- generic phrase matching (no alias table) ----------------
// Used for: (a) the cohort endpoint, which has no server-side `q` support, and
// (b) anywhere else we need a quick client-side relevance check.

function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a), setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersect = 0;
  for (const t of setA) if (setB.has(t)) intersect++;
  return intersect / (setA.size + setB.size - intersect);
}

// handles short shorthand like "g" matching "gastrostomy" by prefix
function matchesInitialism(queryTokens: string[], textTokens: string[]): boolean {
  return queryTokens.every(qt => {
    if (qt.length >= 4) return textTokens.some(tt => tt.includes(qt) || qt.includes(tt));
    return textTokens.some(tt => tt.startsWith(qt));
  });
}

export function recordMatchesPhrase(haystack: string, phrase: string): boolean {
  const h = normalize(haystack);
  const p = normalize(phrase);
  if (!p) return false;
  if (h.includes(p)) return true;

  const ht = tokenize(haystack), pt = tokenize(phrase);
  if (jaccard(ht, pt) >= 0.5) return true;
  return matchesInitialism(pt, ht);
}

export function filterCohortByPhrase(records: CohortProcedureItem[], phrase: string): CohortProcedureItem[] {
  if (!normalize(phrase)) return [];
  return records.filter(r => recordMatchesPhrase(`${r.desc} ${r.code}`, phrase));
}

// ---------------- description-first / content-text-fallback partitioning ----------------
// The server already filtered `records` down to rows matching the phrase (via proc_desc,
// proc_code, or ContentText full-text search). This splits them: if any row matched on the
// formal procedure fields, those are treated as the authoritative set; only when there are
// NONE do we trust the ContentText-only matches.

export function partitionByDescMatch(records: ProcedureRecord[]): {
  descMatches: ProcedureRecord[];
  contentOnlyMatches: ProcedureRecord[];
} {
  const descMatches = records.filter(r => r.desc_match === 1);
  const contentOnlyMatches = records.filter(r => r.desc_match !== 1);
  return { descMatches, contentOnlyMatches };
}

export function pickMatchSet(records: ProcedureRecord[]): { matched: ProcedureRecord[]; source: 'description' | 'dictation' | 'unscoped' } {
  // unscoped: no desc_match field present at all (e.g. q wasn't sent) — treat all as matched
  if (records.length > 0 && records.every(r => typeof r.desc_match === 'undefined')) {
    return { matched: records, source: 'unscoped' };
  }
  const { descMatches, contentOnlyMatches } = partitionByDescMatch(records);
  return descMatches.length > 0
    ? { matched: descMatches, source: 'description' }
    : { matched: contentOnlyMatches, source: 'dictation' };
}

// ---------------- pgy detection ----------------

export function extractPgyFilter(query: string): { pgy: number | null; remainder: string } {
  const m = query.match(/pgy\s*-?\s*(\d)/i) || query.match(/\b(?:year|yr)\s*(\d)\b/i);
  if (!m) return { pgy: null, remainder: query };
  return { pgy: Number(m[1]), remainder: query.replace(m[0], ' ') };
}

// ---------------- aggregation ----------------

export type Trend = 'improving' | 'declining' | 'stable' | 'insufficient';

export function computeTrend(scoresChronological: number[]): Trend {
  const n = scoresChronological.length;
  if (n < 2) return 'insufficient';
  const xMean = (n - 1) / 2;
  const yMean = scoresChronological.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  scoresChronological.forEach((y, x) => { num += (x - xMean) * (y - yMean); den += (x - xMean) ** 2; });
  const slope = den === 0 ? 0 : num / den;
  if (slope > 0.15) return 'improving';
  if (slope < -0.15) return 'declining';
  return 'stable';
}

export interface ProcedureDrilldown {
  procedureLabel: string;
  totalCount: number;
  scoredCount: number;
  averageEpa: number | null;
  lastDate: string | null;
  last5: { date: string; score: number }[];
  trend: Trend;
}

export function buildProcedureDrilldown(records: ProcedureRecord[], label: string): ProcedureDrilldown {
  const sorted = [...records].sort((a, b) => new Date(a.create_date).getTime() - new Date(b.create_date).getTime());
  const scored = sorted.filter((r): r is ProcedureRecord & { oepa: number } => typeof r.oepa === 'number' && r.oepa > 0);
  const last5 = scored.slice(-5).map(r => ({ date: r.create_date, score: r.oepa }));
  const averageEpa = scored.length ? Number((scored.reduce((s, r) => s + r.oepa, 0) / scored.length).toFixed(2)) : null;
  return {
    procedureLabel: label,
    totalCount: records.length,
    scoredCount: scored.length,
    averageEpa,
    lastDate: sorted.length ? sorted[sorted.length - 1].create_date : null,
    last5,
    trend: computeTrend(last5.map(x => x.score)),
  };
}

export function topProcedureBreakdown(records: ProcedureRecord[], topN = 5) {
  const map = new Map<string, { label: string; count: number; sum: number; scored: number }>();
  for (const r of records) {
    const label = (r.proc_desc || r.proc_code || 'Unknown').trim();
    const entry = map.get(label) ?? { label, count: 0, sum: 0, scored: 0 };
    entry.count += 1;
    if (typeof r.oepa === 'number' && r.oepa > 0) { entry.sum += r.oepa; entry.scored += 1; }
    map.set(label, entry);
  }
  return Array.from(map.values())
    .map(e => ({ label: e.label, count: e.count, avg: e.scored ? Number((e.sum / e.scored).toFixed(2)) : null }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

export function aggregateCohort(items: CohortProcedureItem[]): { avg: number; count: number } | null {
  const totalCount = items.reduce((s, i) => s + i.count, 0);
  if (!totalCount) return null;
  return { avg: Number((items.reduce((s, i) => s + i.avg_epa * i.count, 0) / totalCount).toFixed(2)), count: totalCount };
}

export { displayName };