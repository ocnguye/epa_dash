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
import { resolveProcedureAlias } from './epaChatbotEngine';
import type { ProcedureAliasResolution, AliasLookupRow } from './epaChatbotEngine';

// ─── Types re-exported for convenience ───────────────────────────────────────

export type { ProcedureAliasResolution };

export interface ProcTypeRow {
  proc_type_id: number;  // mapped from proc_types.id
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
 * first) as candidate alias strings. Sent to the DB in one IN() query.
 *
 * E.g. "g tube placement" → ["g tube placement", "g tube", "tube placement",
 *                            "g", "tube", "placement"]
 */
function candidateAliases(query: string): string[] {
  const tokens = normalizeText(query).split(' ').filter(Boolean);
  const seen = new Set<string>();
  const results: string[] = [];

  for (let size = tokens.length; size >= 1; size--) {
    for (let i = 0; i + size <= tokens.length; i++) {
      const phrase = tokens.slice(i, i + size).join(' ');
      if (!seen.has(phrase)) {
        seen.add(phrase);
        results.push(phrase);
      }
    }
  }
  return results;
}

// ─── Main entry points ───────────────────────────────────────────────────────

export async function resolveProcedureAliasFromQuery(
  connection: Connection,
  query: string,
): Promise<ProcedureAliasResolution> {
  const aliases = candidateAliases(query);
  if (aliases.length === 0) {
    return { resolved: null, ambiguous: [], matchedAlias: null };
  }

  const placeholders = aliases.map(() => '?').join(', ');
  const [rows] = await connection.execute(
    `SELECT
       pa.alias          AS alias,
       pt.id             AS proc_type_id,
       pt.proc_code,
       pt.proc_desc,
       pt.proc_cat
     FROM proc_aliases pa
     JOIN proc_type_aliases pta ON pta.alias_id = pa.id
     JOIN proc_types pt         ON pt.id = pta.proc_type_id
     WHERE pa.alias IN (${placeholders})`,
    aliases,
  ) as [AliasLookupRow[], any];

  return resolveProcedureAlias(query, rows as AliasLookupRow[]);
}

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