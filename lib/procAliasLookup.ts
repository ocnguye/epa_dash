// lib/procAliasLookup.ts
//
// Server-side counterpart to the client-side resolveProcedureAlias() in
// epaChatbotEngine.ts. Runs against the proc_aliases / proc_type_aliases /
// proc_types tables rather than a pre-fetched in-memory row set.
//
// Schema:
//   proc_aliases        (id, alias)
//   proc_type_aliases   (proc_type_id FK→proc_types.id, alias_id FK→proc_aliases.id)
//   proc_types          (id, proc_code, proc_desc, proc_cat, core_category, complexity)

import type { Connection } from 'mysql2/promise';
import type { ProcedureAliasResolution, AliasLookupRow } from './epaChatbotEngine';

export type { ProcedureAliasResolution };

export interface ProcTypeRow {
  proc_type_id: number; // mapped from proc_types.id
  proc_code: string;
  proc_desc: string;
  proc_cat: string | null;
  complexity: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Generate every contiguous sub-sequence of tokens from `query` (longest
 * first). Used for exact-match candidates.
 *
 * "g tube" → ["g tube", "g", "tube"]
 */
function candidateAliases(query: string): string[] {
  const tokens = normalizeText(query).split(' ').filter(Boolean);
  const seen = new Set<string>();
  const results: string[] = [];
  for (let size = tokens.length; size >= 1; size--) {
    for (let i = 0; i + size <= tokens.length; i++) {
      const phrase = tokens.slice(i, i + size).join(' ');
      if (!seen.has(phrase)) { seen.add(phrase); results.push(phrase); }
    }
  }
  return results;
}

// ─── Two-phase resolution ─────────────────────────────────────────────────────
//
// Phase 1 — exact match: alias text must exactly equal one of the candidate
//   sub-sequences from the query (case-insensitive). "g tube placement"
//   matches the alias "G tube placement" exactly and resolves in one shot.
//
// Phase 2 — contains match (fallback): if phase 1 finds nothing, try each
//   candidate sub-sequence as a LIKE '%candidate%' against alias text,
//   longest candidate first. This is what makes "g tube" find "G tube
//   exchange" and "G tube placement" so the attending gets a disambiguation
//   card rather than falling through to a loose ProcedureDescList LIKE query.
//
//   Guard: only run contains on candidates with 3+ characters AND at least
//   2 tokens (i.e. "g tube" qualifies; bare "tube" does not). This prevents
//   short single words from matching across unrelated procedure families.
//
// In both phases: if the best alias maps to exactly one proc_type → resolved.
// If it maps to multiple → ambiguous (show the multi-select disambiguation card).

export async function resolveProcedureAliasFromQuery(
  connection: Connection,
  query: string,
): Promise<ProcedureAliasResolution> {
  const candidates = candidateAliases(query);
  if (candidates.length === 0) {
    return { resolved: null, ambiguous: [], matchedAlias: null };
  }

  // ── Phase 1: exact match (case-insensitive) ───────────────────────────────
  const exactPlaceholders = candidates.map(() => '?').join(', ');
  const [exactRows] = await connection.execute(
    `SELECT
       pa.alias          AS alias,
       pt.id             AS proc_type_id,
       pt.proc_code,
       pt.proc_desc,
       pt.proc_cat
     FROM proc_aliases pa
     JOIN proc_type_aliases pta ON pta.alias_id = pa.id
     JOIN proc_types pt         ON pt.id = pta.proc_type_id
     WHERE LOWER(pa.alias) IN (${exactPlaceholders})`,
    candidates,
  ) as [AliasLookupRow[], any];

  if (exactRows.length > 0) {
    return resolveFromRows(exactRows as AliasLookupRow[]);
  }

  // ── Phase 2: contains match, longest qualifying candidate first ───────────
  //
  // A candidate qualifies for contains matching only if it has at least 2
  // tokens (e.g. "g tube") or is a single word of 4+ characters (e.g. "para",
  // "picc"). This prevents bare short words like "tube" from matching
  // "Chest tube", "G tube", "neph tube" all at once.
  const qualifiedCandidates = candidates.filter(c => {
    const tokens = c.split(' ').filter(Boolean);
    return tokens.length >= 2 || c.length >= 4;
  });

  for (const candidate of qualifiedCandidates) {
    const [containsRows] = await connection.execute(
      `SELECT
         pa.alias          AS alias,
         pt.id             AS proc_type_id,
         pt.proc_code,
         pt.proc_desc,
         pt.proc_cat
       FROM proc_aliases pa
       JOIN proc_type_aliases pta ON pta.alias_id = pa.id
       JOIN proc_types pt         ON pt.id = pta.proc_type_id
       WHERE LOWER(pa.alias) LIKE ?`,
      [`%${candidate}%`],
    ) as [AliasLookupRow[], any];

    if ((containsRows as AliasLookupRow[]).length > 0) {
      // Re-label all rows with the candidate the user typed so resolveFromRows
      // groups them correctly under one matched alias.
      const labelled = (containsRows as AliasLookupRow[]).map(r => ({
        ...r,
        alias: candidate,
      }));
      return resolveFromRows(labelled);
    }
  }

  // Nothing matched — caller falls back to LIKE on ProcedureDescList.
  return { resolved: null, ambiguous: [], matchedAlias: null };
}

/**
 * Given rows that all share the same matched alias (or have been re-labelled
 * to do so), decide: resolved (one proc_type) vs ambiguous (multiple).
 */
function resolveFromRows(rows: AliasLookupRow[]): ProcedureAliasResolution {
  // If somehow multiple alias strings came through, pick the longest.
  const byLength = Array.from(new Set(rows.map(r => r.alias))).sort((a, b) => b.length - a.length);
  const chosenAlias = byLength[0];
  const matching = rows.filter(r => r.alias === chosenAlias);

  const candidates = Array.from(
    new Map(matching.map(r => [r.proc_type_id, {
      proc_type_id: r.proc_type_id,
      proc_code: r.proc_code,
      proc_desc: r.proc_desc,
      proc_cat: r.proc_cat,
    }])).values()
  );

  if (candidates.length === 1) {
    return { resolved: candidates, ambiguous: [], matchedAlias: chosenAlias };
  }

  return {
    resolved: null,
    ambiguous: candidates.map(c => ({ procedure: c, matchedAlias: chosenAlias })),
    matchedAlias: chosenAlias,
  };
}

// ─── getProcTypesByIds ────────────────────────────────────────────────────────

export async function getProcTypesByIds(
  connection: Connection,
  ids: number[],
): Promise<ProcTypeRow[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  const [rows] = await connection.execute(
    `SELECT id AS proc_type_id, proc_code, proc_desc, proc_cat, complexity
     FROM proc_types
     WHERE id IN (${placeholders})`,
    ids,
  ) as [ProcTypeRow[], any];
  return rows;
}