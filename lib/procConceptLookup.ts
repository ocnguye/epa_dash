// lib/procConceptLookup.ts
//
// "Closest procedure" lookup for queries that match nothing directly.
// Pure SQL + string rules, no models:
//
//   1. Break the query into tokens and add word-part stems
//      (thrombectomy → thromb, nephrostomy → nephrost…).
//   2. Look those up in proc_concepts (exact words, or prefix roots).
//   3. Score each linked proc_type by the strength of the concepts that hit.
//
// Runs only AFTER alias resolution and the ProcedureDescList LIKE fallback
// have both come up empty, so exact matches always win.
//
// Tables: proc_concepts, proc_type_concepts (see proc_concepts_seed.sql).

import type { Connection } from 'mysql2/promise';

export interface ClosestProcCandidate {
  proc_type_id: number;
  proc_code: string;
  proc_desc: string;
  proc_cat: string | null;
  reason: string;          // human-readable concept(s) that matched, e.g. "clot removal"
  trainee_cases?: number;  // cases this trainee has logged for the procedure, when known
}

// Modality prefixes sit in nearly every proc_desc, so they carry no signal.
const STOP = new Set(['ir', 'ct', 'us', 'fl', 'mri', 'the', 'and', 'for', 'with', 'of', 'a']);

// Medical suffixes to strip when deriving stems. Longest first.
const SUFFIXES = [
  'ectomy', 'ostomy', 'otomy', 'centesis', 'plasty', 'graphy', 'ization',
  'isation', 'scopy', 'lysis', 'gram', 'ation', 'ing', 'es', 's',
];

const MIN_TOKEN = 3;
const MIN_STEM = 4;
const MAX_PROBES = 16;
const MIN_SCORE = 0.3;

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Tokens plus their suffix-stripped stems, deduped. */
export function probesFor(query: string): string[] {
  const tokens = normalizeText(query)
    .split(' ')
    .filter(t => t.length >= MIN_TOKEN && !STOP.has(t));

  const out = new Set<string>();
  for (const t of tokens) {
    out.add(t);
    for (const suf of SUFFIXES) {
      if (t.endsWith(suf) && t.length - suf.length >= MIN_STEM) {
        out.add(t.slice(0, -suf.length));
      }
    }
  }
  return Array.from(out).slice(0, MAX_PROBES);
}

function prettyConcept(key: string): string {
  return key.replace(/-/g, ' ');
}

export async function findClosestProcTypes(
  connection: Connection,
  query: string,
  opts: { caseCounts?: Map<number, number>; topN?: number } = {},
): Promise<ClosestProcCandidate[]> {
  const { caseCounts, topN = 5 } = opts;
  const probes = probesFor(query);
  if (probes.length === 0) return [];

  // A probe hits a concept term if it equals it, or (for prefix roots) starts with it.
  const where = probes
    .map(() => `(c.term = ? OR (c.match_mode = 'prefix' AND ? LIKE CONCAT(c.term, '%')))`)
    .join(' OR ');

  const [rows] = await connection.execute(
    `SELECT DISTINCT
        ptc.proc_type_id, pt.proc_code, pt.proc_desc, pt.proc_cat,
        ptc.concept_key, ptc.strength
       FROM proc_concepts c
       JOIN proc_type_concepts ptc ON ptc.concept_key = c.concept_key
       JOIN proc_types pt          ON pt.id = ptc.proc_type_id
      WHERE ${where}`,
    probes.flatMap(p => [p, p]),
  ) as [any[], any];

  // Sum strength per procedure, counting each concept once.
  const byProc = new Map<number, {
    code: string; desc: string; cat: string | null;
    concepts: Map<string, number>;
  }>();

  for (const r of rows) {
    const id = Number(r.proc_type_id);
    let entry = byProc.get(id);
    if (!entry) {
      entry = { code: r.proc_code, desc: r.proc_desc, cat: r.proc_cat ?? null, concepts: new Map() };
      byProc.set(id, entry);
    }
    const prev = entry.concepts.get(r.concept_key) ?? 0;
    entry.concepts.set(r.concept_key, Math.max(prev, Number(r.strength)));
  }

  const scored = Array.from(byProc.entries()).map(([id, e]) => {
    const base = Array.from(e.concepts.values()).reduce((a, b) => a + b, 0);
    const cases = caseCounts?.get(id) ?? 0;
    return {
      id, e, cases,
      score: base + (cases > 0 ? 0.25 : 0), // small nudge toward what this trainee actually does
    };
  });

  return scored
    .filter(s => s.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || b.cases - a.cases || a.e.desc.localeCompare(b.e.desc))
    .slice(0, topN)
    .map(s => ({
      proc_type_id: s.id,
      proc_code: s.e.code,
      proc_desc: s.e.desc,
      proc_cat: s.e.cat,
      reason: Array.from(s.e.concepts.keys()).map(prettyConcept).join(', '),
      ...(caseCounts ? { trainee_cases: s.cases } : {}),
    }));
}