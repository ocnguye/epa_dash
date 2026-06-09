#!/usr/bin/env node
/**
 * scripts/manual_resolve.js
 *
 * Interactive CLI to resolve unmatched names from unmatched_people.csv.
 * For each entry it shows fuzzy-matched candidates from the users table,
 * lets you pick one by index, enter a user_id manually, skip, or mark NULL.
 *
 * Each confirmed mapping is written to:
 *   - report_participants (the actual participant row)
 *   - user_name_aliases   (so future extract_personnel runs skip it automatically)
 *
 * Rows that already exist in report_participants are silently skipped —
 * no prompt is shown and no error is thrown.
 *
 * Usage:
 *   node scripts/manual_resolve.js --input output/unmatched_people.csv
 */

'use strict';

require('dotenv').config();

const mysql    = require('mysql2/promise');
const fs       = require('fs');
const path     = require('path');
const readline = require('readline');
const yargs    = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const stringSimilarity = require('string-similarity');

// ─── DB config ────────────────────────────────────────────────────────────────

function getRdsConfig() {
  return {
    host:     process.env.AWS_RDS_HOST,
    user:     process.env.AWS_RDS_USER,
    password: process.env.AWS_RDS_PWD,
    database: process.env.AWS_RDS_DB,
    port:     Number(process.env.AWS_RDS_PORT || 3306),
  };
}

// ─── CSV loader ───────────────────────────────────────────────────────────────

function loadCSV(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  const headers = raw[0].split(',');
  return raw.slice(1).map(line => {
    // Simple CSV parse — handles quoted fields
    const cols = [];
    let cur = '', inQuote = false;
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === ',' && !inQuote) { cols.push(cur); cur = ''; }
      else cur += ch;
    }
    cols.push(cur);
    const obj = {};
    headers.forEach((h, i) => obj[h.trim()] = (cols[i] || '').trim());
    return obj;
  });
}

// ─── Prompt helper ────────────────────────────────────────────────────────────

function ask(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(query, ans => { rl.close(); resolve(ans.trim()); }));
}

// ─── User search ──────────────────────────────────────────────────────────────

async function findCandidates(conn, name) {
  const terms = name.toLowerCase().split(/[\s\-]+/).filter(Boolean);
  const orConditions = terms.map(() =>
    `LOWER(first_name) LIKE ? OR LOWER(last_name) LIKE ? OR LOWER(COALESCE(preferred_name,'')) LIKE ?`
  ).join(' OR ');
  const params = terms.flatMap(t => [`%${t}%`, `%${t}%`, `%${t}%`]);
  const [rows] = await conn.execute(
    `SELECT user_id, first_name, last_name, preferred_name, role FROM users WHERE ${orConditions}`,
    params
  );
  const inputNorm = name.toLowerCase().replace(/[\-']/g,' ').replace(/\s+/g,' ').trim();
  return rows
    .map(u => {
      const full = `${u.first_name} ${u.last_name} ${u.preferred_name||''}`.toLowerCase().trim();
      const score = stringSimilarity.compareTwoStrings(inputNorm, full);
      return { ...u, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

// ─── DB writes ────────────────────────────────────────────────────────────────

async function participantExists(conn, reportId, role, userId) {
  const [rows] = await conn.execute(
    `SELECT id FROM report_participants WHERE report_id=? AND role=? AND user_id=? LIMIT 1`,
    [reportId, role, userId]
  );
  return rows.length > 0;
}

async function upsertParticipant(conn, reportId, role, name, userId) {
  await conn.execute(
    `INSERT INTO report_participants (report_id, role, source_text, user_id)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE user_id=VALUES(user_id), source_text=VALUES(source_text)`,
    [reportId, role, name, userId]
  );
}

async function storeAlias(conn, alias, role, userId) {
  await conn.execute(
    `INSERT IGNORE INTO user_name_aliases (alias, role, user_id)
     VALUES (?, ?, ?)`,
    [alias.trim().toLowerCase(), role, userId]
  );
}

async function aliasLookup(conn, alias, role) {
  const [rows] = await conn.execute(
    `SELECT user_id FROM user_name_aliases WHERE alias=? AND role=?`,
    [alias.trim().toLowerCase(), role]
  );
  return rows.map(r => r.user_id);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const argv = yargs(hideBin(process.argv))
    .usage('Usage: $0 <input>')
    .check(argv => {
      if (!argv._[0]) throw new Error('Missing required argument: <input>');
      return true;
    })
    .argv;

  const inputPath = path.resolve(argv._[0]);
  const conn = await mysql.createConnection(getRdsConfig());
  const rows = loadCSV(inputPath);
  console.log(`\nLoaded ${rows.length} unresolved entries from ${inputPath}\n`);

  let resolved = 0, skipped = 0, nulled = 0, alreadyDone = 0;

  for (const row of rows) {
    const { reportId, role, name } = row;

    // ── Check alias table ──────────────────────────────────────────────────────
    const aliasUserIds = await aliasLookup(conn, name, role);

    if (aliasUserIds.length === 1) {
      // Unambiguous — auto-apply without prompting
      const userId = aliasUserIds[0];
      const exists = await participantExists(conn, reportId, role, userId);
      if (!exists) {
        await upsertParticipant(conn, reportId, role, name, userId);
        console.log(`  [auto] "${name}" → user_id=${userId} (alias)`);
        resolved++;
      } else {
        alreadyDone++;
      }
      continue;
    }

    // aliasUserIds.length > 1 → ambiguous, must prompt
    // aliasUserIds.length === 0 → no alias yet, must prompt

    // ── Skip only if this exact report+role+name combo is already resolved ─────
    const [existingRows] = await conn.execute(
      `SELECT id, user_id FROM report_participants
       WHERE report_id=? AND role=? AND source_text=? LIMIT 1`,
      [reportId, role, name]
    );
    if (existingRows.length && existingRows[0].user_id !== null) {
      alreadyDone++;
      continue;
    }

    // ── Prompt ─────────────────────────────────────────────────────────────────
    console.log('\n' + '─'.repeat(60));
    console.log(`[${role}] "${name}"  (ReportID: ${reportId})`);

    if (aliasUserIds.length > 1) {
      console.log(`  ⚠  Ambiguous: "${name}" is already mapped to user_ids [${aliasUserIds.join(', ')}].`);
      console.log(`     Pick the correct one for this report — the alias table will NOT be updated.`);
    }

    const candidates = await findCandidates(conn, name);
    if (!candidates.length) {
      console.log('  No candidates found in users table.');
    } else {
      candidates.forEach((u, i) => {
        const preferred = u.preferred_name ? ` (pref: ${u.preferred_name})` : '';
        const ambigMarker = aliasUserIds.includes(u.user_id) ? '  ← existing alias' : '';
        console.log(`  [${i}] ${u.first_name} ${u.last_name}${preferred}  id=${u.user_id}  role=${u.role}  score=${u.score.toFixed(2)}${ambigMarker}`);
      });
    }
    console.log('  [m] enter user_id manually');
    console.log('  [n] leave NULL (skip this entry)');
    console.log('  [q] quit');

    const choice = await ask('  Select: ');
    if (choice === 'q') break;

    if (choice === 'n') {
      console.log('  → Skipped (NULL).');
      nulled++;
      continue;
    }

    let userId;
    if (choice === 'm') {
      const manual = await ask('  Enter user_id: ');
      const parsed = Number(manual);
      if (Number.isNaN(parsed) || parsed <= 0) { console.log('  Invalid user_id, skipping.'); skipped++; continue; }
      userId = parsed;
    } else {
      const idx = Number(choice);
      if (Number.isNaN(idx) || !candidates[idx]) { console.log('  Invalid selection, skipping.'); skipped++; continue; }
      userId = candidates[idx].user_id;
    }

    await upsertParticipant(conn, reportId, role, name, userId);

    // Only write alias if name is genuinely new — ambiguous names get a
    // participant row written per-report but the alias table stays untouched
    // so extract_personnel keeps routing them here for manual adjudication.
    if (aliasUserIds.length === 0) {
      await storeAlias(conn, name, role, userId);
      console.log(`  → Mapped to user_id=${userId} and saved alias.`);
    } else {
      console.log(`  → Mapped to user_id=${userId} (participant row written; alias table unchanged).`);
    }
    resolved++;
  }

  await conn.end();

  console.log('\n' + '═'.repeat(60));
  console.log('  MANUAL RESOLVE COMPLETE');
  console.log('─'.repeat(60));
  console.log(`  Resolved this session   : ${resolved}`);
  console.log(`  Already done (skipped)  : ${alreadyDone}`);
  console.log(`  Left as NULL            : ${nulled}`);
  console.log(`  Invalid input (skipped) : ${skipped}`);
  console.log('═'.repeat(60));
  console.log('\nNext: re-run extract_personnel.js --write --limit 0 --force');
  console.log('      then run extract_epa.js --write --limit 0\n');
}

main().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });