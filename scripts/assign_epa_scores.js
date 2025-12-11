#!/usr/bin/env node
/**
 * scripts/assign_epa_scores.js
 *
 * Scans the `reports` table for lines like "<Trainee Name> Trainee EPA: [1-5]"
 * then maps the parsed trainee name to one `report_participants` row for the same
 * report and inserts/updates an `epa_scores` row linking that participant to the score.
 *
 * Usage:
 *   node scripts/assign_epa_scores.js --limit 500 --dry-run
 *   node scripts/assign_epa_scores.js --limit 500 --write
 *
 * Options:
 *   --limit   Number of reports to scan (default 500)
 *   --dry-run Don't write to DB; only log actions (default true)
 *   --write   Write/insert/update `epa_scores` (overrides dry-run)
 *
 * Notes:
 * - The script prefers to match the parsed trainee name against `report_participants.source_text` or
 *   the resolved user's name when `report_participants.user_id` is set. Matching is performed by
 *   normalizing names (lowercasing, punctuation removal) and trying exact-then-lastname heuristics.
 * - Ambiguous matches (0 or >1 candidates) are logged and skipped for manual review.
 */

const mysql = require('mysql2/promise');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
require('dotenv').config();

const argv = yargs(hideBin(process.argv))
  .option('limit', { type: 'number', default: 500 })
  .option('dry-run', { type: 'boolean', default: true })
  .option('write', { type: 'boolean', default: false })
  .argv;

const DB = {
  host: process.env.RDS_HOST || process.env.AWS_RDS_HOST,
  user: process.env.RDS_USER || process.env.AWS_RDS_USER,
  password: process.env.RDS_PWD || process.env.AWS_RDS_PWD || process.env.AWS_RDS_PASS,
  database: process.env.RDS_DB || process.env.AWS_RDS_DB,
  port: process.env.RDS_PORT ? Number(process.env.RDS_PORT) : 3306,
  // increase connection limit if needed
};

function normalizeName(s) {
  if (!s || typeof s !== 'string') return '';
  return s
    .replace(/\b(Dr|Doctor|Prof|Professor|Mr|Mrs|Ms)\b\.?/gi, ' ')
    .replace(/\b(MD|DO|PhD|RN|PA|NP|MBBS)\b\.?/gi, ' ')
    .replace(/\bPGY[0-9\/\-]*\b/gi, ' ')
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'") // normalize smart quotes
    .replace(/[^\w\s'\-]/g, ' ') // remove punctuation except apostrophe/hyphen
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractProceduralPersonnelBlock(text) {
  if (!text) return '';
  const m = text.match(/Procedural\s+Personnel\s*:?(.*?)(?:\n\s*\n|$)/is);
  return m ? m[1] : '';
}

async function resolveUsersMap(conn, userIds) {
  if (!userIds || userIds.length === 0) return {};
  const uniq = Array.from(new Set(userIds));
  const placeholders = uniq.map(() => '?').join(',');
  const [rows] = await conn.execute(`SELECT user_id, preferred_name, first_name, last_name FROM users WHERE user_id IN (${placeholders})`, uniq);
  const map = {};
  for (const r of rows) {
    const names = [];
    if (r.preferred_name) names.push(r.preferred_name);
    if (r.first_name || r.last_name) names.push(`${r.first_name || ''} ${r.last_name || ''}`.trim());
    map[Number(r.user_id)] = names.filter(Boolean);
  }
  return map;
}

(async function main() {
  const conn = await mysql.createConnection(DB);
  try {
    console.log('[INFO] Connected to DB. Prefiltering reports that contain "Trainee EPA" with score 1-5.');
    const regex = 'Trainee\\s+EPA[:#]?\\s*[1-5]';
    // Some MySQL servers/drivers don't accept LIMIT as a prepared-statement parameter.
    // Safely interpolate the integer limit after validation and keep the regex as a parameter.
    const safeLimit = Math.max(1, Math.min(10000, Number(argv.limit) || 500));
    const [reports] = await conn.execute(
      `SELECT ReportID, ContentText FROM reports WHERE ContentText REGEXP ? LIMIT ${safeLimit}`,
      [regex]
    );
  console.log(`[INFO] Found ${reports.length} candidate reports (limit=${argv.limit}).`);
  const fs = require('fs');
  const unmatched = [];

    for (const r of reports) {
      const reportId = r.ReportID;
      const text = r.ContentText || '';
  const ppBlock = extractProceduralPersonnelBlock(text);
  // If Procedural Personnel block isn't present, fall back to scanning the whole report text.
  // Previously we skipped reports without a ppBlock which could miss some EPA lines located elsewhere.
  const initialSearch = ppBlock || text;

      // find name + score pairs on same line; e.g. "John Moon Trainee EPA: 5"
      // Accept names starting with any letter, allow commas (Last, First) and be a bit more permissive.
      const lineRe = /([A-Za-z][A-Za-z.'\-\s,]{1,120}?)\s+Trainee\s+EPA\s*[:#]?\s*([1-5])/gi;
      let m;
      const pairs = [];
  while ((m = lineRe.exec(initialSearch)) !== null) {
        let rawName = (m[1] || '').trim();
        const score = Number(m[2]);
        // normalize "Last, First" -> "First Last" for matching convenience
        if (rawName.includes(',') && rawName.split(',').length >= 2) {
          const parts = rawName.split(',').map(s => s.trim()).filter(Boolean);
          rawName = parts.slice(1).concat(parts[0]).join(' ');
        }
        if (rawName && score >= 1 && score <= 5) pairs.push({ rawName, score, source: 'ppBlock' });
      }

  // If we didn't find any pairs in the initial search (ppBlock or full text), try scanning the full report text
  if (pairs.length === 0) {
        // permissive regex: name before score (already handled) OR score before name (e.g. "Trainee EPA: 5 - John Doe")
        const fullRe1 = /([A-Za-z][A-Za-z.'\-\s,]{1,120}?)\s+Trainee\s+EPA\s*[:#]?\s*([1-5])/gi;
        const fullRe2 = /Trainee\s+EPA\s*[:#]?\s*([1-5])\s*[-–—:\s]{0,4}\s*([A-Za-z][A-Za-z.'\-\s,]{1,120}?)/gi;
        while ((m = fullRe1.exec(text)) !== null) {
          let rawName = (m[1] || '').trim();
          const score = Number(m[2]);
          if (rawName.includes(',') && rawName.split(',').length >= 2) {
            const parts = rawName.split(',').map(s => s.trim()).filter(Boolean);
            rawName = parts.slice(1).concat(parts[0]).join(' ');
          }
          if (rawName && score >= 1 && score <= 5) pairs.push({ rawName, score, source: 'fullText' });
        }
        while ((m = fullRe2.exec(text)) !== null) {
          let rawName = (m[2] || '').trim();
          const score = Number(m[1]);
          if (rawName.includes(',') && rawName.split(',').length >= 2) {
            const parts = rawName.split(',').map(s => s.trim()).filter(Boolean);
            rawName = parts.slice(1).concat(parts[0]).join(' ');
          }
          if (rawName && score >= 1 && score <= 5) pairs.push({ rawName, score, source: 'fullText' });
        }
      }
      if (pairs.length === 0) continue;

      // fetch participants for this report
      const [parts] = await conn.execute(
        `SELECT id, user_id, role, source_text FROM report_participants WHERE report_id = ?`,
        [reportId]
      );
      if (!parts || parts.length === 0) {
        console.warn(`[WARN] report ${reportId} has no report_participants rows; skipping`);
        continue;
      }

      // prepare user lookup for participants that have user_id set
      const userIds = parts.filter(p => p.user_id).map(p => p.user_id);
      const usersMap = await resolveUsersMap(conn, userIds);

      // build candidate list for each participant (only trainees are relevant)
      const candidates = parts
        .filter(p => p.role === 'trainee')
        .map(p => {
        const c = { id: p.id, role: p.role, source_text: p.source_text || '', user_id: p.user_id || null, names: [] };
        // if we have resolved user names, add them
        if (c.user_id && usersMap[c.user_id]) c.names.push(...usersMap[c.user_id]);
        // parse source_text into name fragments (split on ; / & and ' and ')
        const src = (p.source_text || '')
          .replace(/[,\(\)\[\]]/g, ' ')
          .split(/\s*(?:;|\/|&|\band\b)\s*/i)
          .map(s => s.trim())
          .filter(Boolean);
        c.names.push(...src);
        // final normalized name set
        c.norms = Array.from(new Set(c.names.map(normalizeName).filter(Boolean)));
        return c;
      });

      // helper: find single trainee participant if present
      const traineeParticipants = parts.filter(p => p.role === 'trainee');

      for (const { rawName, score } of pairs) {
        const parsedNorm = normalizeName(rawName);
        const parsedLast = parsedNorm.split(' ').slice(-1)[0] || '';

        // matching strategy (prefer direct user_id or exact name matches)
        let matched = [];

        // If the parsed token is purely numeric, try matching it to a user_id or rp id
        const asNum = Number(parsedNorm.replace(/[^0-9]/g, ''));
        if (String(asNum) === parsedNorm && !Number.isNaN(asNum)) {
          // match by user_id first
          matched = candidates.filter(c => c.user_id && Number(c.user_id) === asNum);
          // if none, try matching by report_participant id
          if (matched.length === 0) matched = candidates.filter(c => Number(c.id) === asNum);
        }

        // exact normalized name match
        if (matched.length === 0) matched = candidates.filter(c => c.norms.includes(parsedNorm));

        // fallback: last-name contains
        if (matched.length === 0 && parsedLast) {
          matched = candidates.filter(c => c.norms.some(n => n.includes(parsedLast)));
        }

        // If still nothing, but there's exactly one trainee participant for the report, auto-assign
        if (matched.length === 0 && traineeParticipants.length === 1) {
          matched = candidates.filter(c => true); // will pick the sole candidate below
        }

        if (matched.length === 1) {
          const rpId = matched[0].id;
          console.log(`[ASSIGN] report ${reportId}: "${rawName}" -> report_participant ${rpId} (score ${score})`);
          if (argv.write) {
            // idempotent upsert: check existing
            const [ex] = await conn.execute(`SELECT id, epa_score FROM epa_scores WHERE report_participant_id = ? LIMIT 1`, [rpId]);
            if (ex && ex.length > 0) {
              const rec = ex[0];
              if (rec.epa_score !== score) {
                await conn.execute(`UPDATE epa_scores SET epa_score = ?, created_at = NOW() WHERE id = ?`, [score, rec.id]);
                console.log(`[UPDATE] epa_scores.id=${rec.id} updated to ${score}`);
              } else {
                // identical: skip
              }
            } else {
              await conn.execute(`INSERT INTO epa_scores (report_participant_id, epa_score) VALUES (?, ?)`, [rpId, score]);
              console.log(`[INSERT] epa_scores for report_participant_id=${rpId} score=${score}`);
            }
          }
        } else if (matched.length === 0) {
          console.warn(`[SKIP] report ${reportId}: no match for parsed name "${rawName}" (score ${score}). Candidates: ${candidates.map(c => c.names.join('|')).join(' || ')}`);
          unmatched.push({
            reportId,
            rawName,
            score,
            reason: 'no_match',
            candidates: candidates.map(c => ({ id: c.id, user_id: c.user_id, names: c.names, source_text: c.source_text })),
            ppBlock: ppBlock ? ppBlock.slice(0,500) : ''
          });
        } else {
          // ambiguous
          console.warn(`[SKIP] report ${reportId}: ambiguous match for "${rawName}" (score ${score}). ${matched.length} candidates: ${matched.map(m=>m.names.join('|')).join(' || ')}`);
          unmatched.push({
            reportId,
            rawName,
            score,
            reason: 'ambiguous',
            matches: matched.map(m => ({ id: m.id, user_id: m.user_id, names: m.names })),
            candidates: candidates.map(c => ({ id: c.id, user_id: c.user_id, names: c.names })),
            ppBlock: ppBlock ? ppBlock.slice(0,500) : ''
          });
        }
      }
    }

    // write unmatched cases to a JSON file for inspection
    try {
      const outPath = __dirname + '/assign_epa_scores_unmatched.json';
      fs.writeFileSync(outPath, JSON.stringify(unmatched, null, 2), 'utf8');
      console.log(`[INFO] Wrote ${unmatched.length} unmatched cases to ${outPath}`);
    } catch (e) {
      console.error('[WARN] Failed to write unmatched cases file', e);
    }

    console.log('[DONE] Processing complete.');
  } catch (err) {
    console.error('[ERROR]', err);
    process.exitCode = 1;
  } finally {
    try { await conn.end(); } catch (e) { }
  }
})();
