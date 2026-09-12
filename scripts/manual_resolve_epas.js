#!/usr/bin/env node
/**
 * scripts/manual_resolve_epa.js
 *
 * Interactive CLI to manually assign EPA scores from unmatched_epa_scores.csv.
 * Handles two cases:
 *   1. reason=no_score             — participant is known but EPA label was NR
 *      or missing. Skipped automatically.
 *   2. reason=no_participant_match — score was found but no trainee participant
 *      row matched the name. Shows trainees assigned to that report and lets
 *      you pick one to assign the score to, manually enter/search for a
 *      trainee not shown, or skip if it doesn't belong.
 *
 * Usage:
 *   node scripts/manual_resolve_epa.js output/unmatched_epa_scores.csv
 */

'use strict';

require('dotenv').config();

const mysql    = require('mysql2/promise');
const fs       = require('fs');
const path     = require('path');
const readline = require('readline');
const yargs    = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

function getRdsConfig() {
  return {
    host:     process.env.AWS_RDS_HOST,
    user:     process.env.AWS_RDS_USER,
    password: process.env.AWS_RDS_PWD,
    database: process.env.AWS_RDS_DB,
    port:     Number(process.env.AWS_RDS_PORT || 3306),
  };
}

function loadCSV(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
  const headers = raw[0].split(',');
  return raw.slice(1).map(line => {
    const cols = []; let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; }
      else cur += ch;
    }
    cols.push(cur);
    const obj = {}; headers.forEach((h, i) => obj[h.trim()] = (cols[i] || '').trim());
    return obj;
  });
}

function ask(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(query, ans => { rl.close(); resolve(ans.trim()); }));
}

async function getTraineesForReport(conn, reportId) {
  const [rows] = await conn.execute(
    `SELECT rp.id, rp.source_text, u.first_name, u.last_name
     FROM report_participants rp
     LEFT JOIN users u ON u.user_id = rp.user_id
     WHERE rp.report_id = ? AND rp.role = 'trainee'
     ORDER BY u.last_name, u.first_name`,
    [reportId]
  );
  return rows;
}

// Look up candidate trainees by user_id (if the query is all digits) or by
// name substring, so a trainee who was never extracted for this report at
// all (not just mismatched) can still be found and assigned manually.
async function findUserByQuery(conn, query) {
  if (/^\d+$/.test(query)) {
    const [rows] = await conn.execute(
      `SELECT user_id, first_name, last_name, role FROM users WHERE user_id = ?`,
      [query]
    );
    return rows;
  }
  const like = `%${query}%`;
  const [rows] = await conn.execute(
    `SELECT user_id, first_name, last_name, role FROM users
     WHERE first_name LIKE ? OR last_name LIKE ? OR CONCAT(first_name,' ',last_name) LIKE ?
     ORDER BY (role = 'trainee') DESC, last_name, first_name
     LIMIT 10`,
    [like, like, like]
  );
  return rows;
}

// Get this trainee's report_participants row for the report, creating one
// if it doesn't exist yet — needed when the extraction pipeline missed them
// entirely rather than just mismatching an already-present row.
async function getOrCreateParticipant(conn, reportId, userId, sourceText) {
  const [existing] = await conn.execute(
    `SELECT id FROM report_participants WHERE report_id = ? AND user_id = ? AND role = 'trainee' LIMIT 1`,
    [reportId, userId]
  );
  if (existing.length) return { id: existing[0].id, created: false };
  const [res] = await conn.execute(
    `INSERT INTO report_participants (report_id, user_id, role, source_text) VALUES (?, ?, 'trainee', ?)`,
    [reportId, userId, sourceText || null]
  );
  return { id: res.insertId, created: true };
}

// Interactive search/select loop for manually specifying a trainee who
// wasn't offered in the auto-extracted list. Returns
// {id, first_name, last_name} for the resolved report_participants row, or
// null if the user backs out.
async function manualEntryFlow(conn, reportId, rawName) {
  while (true) {
    const q = await ask('  Enter a trainee name to search, a user_id, or [b] to go back: ');
    if (q.toLowerCase() === 'b' || q === '') return null;

    const matches = await findUserByQuery(conn, q);
    if (!matches.length) {
      console.log('  No matching users found. Try again, or [b] to go back.\n');
      continue;
    }

    console.log('\n  Matches:');
    matches.forEach((u, idx) =>
      console.log(`    [${idx}] ${u.first_name || '?'} ${u.last_name || '?'}  (user_id: ${u.user_id}, role: ${u.role || 'unknown'})`)
    );
    console.log('    [b] back / search again\n');

    const pick = await ask('  Select a match: ');
    if (pick.toLowerCase() === 'b') continue;

    const idx = Number(pick);
    if (isNaN(idx) || !matches[idx]) { console.log('  Invalid selection.\n'); continue; }

    const user = matches[idx];
    if (user.role && user.role !== 'trainee') {
      const confirm = await ask(`  Note: this user's role is "${user.role}", not "trainee". Assign anyway? [y/N] `);
      if (confirm.toLowerCase() !== 'y') continue;
    }

    const { id, created } = await getOrCreateParticipant(conn, reportId, user.user_id, rawName);
    if (created) console.log(`  Created new trainee participant row (id: ${id}) for report ${reportId}.`);
    return { id, first_name: user.first_name, last_name: user.last_name };
  }
}

async function scoreExists(conn, participantId, score) {
  const [rows] = await conn.execute(
    `SELECT id FROM epa_scores
     WHERE report_participant_id = ${Number(participantId)}
       AND epa_score = ${Number(score)}`
  );
  return rows.length > 0;
}

async function writeScore(conn, participantId, score) {
  if (await scoreExists(conn, participantId, score)) return false;
  await conn.execute(
    `INSERT INTO epa_scores (report_participant_id, epa_score)
     VALUES (${Number(participantId)}, ${Number(score)})`
  );
  return true;
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .usage('Usage: $0 <input>')
    .check(argv => {
      if (!argv._[0]) throw new Error('Missing required argument: <input>');
      return true;
    })
    .argv;

  const inputPath = path.resolve(argv._[0]);
  const conn      = await mysql.createConnection(getRdsConfig());
  const rows      = loadCSV(inputPath);

  const noScore     = rows.filter(r => r.reason === 'no_score');
  const noMatch     = rows.filter(r => r.reason === 'no_participant_match');
  const unrecognised = rows.filter(r => r.reason !== 'no_score' && r.reason !== 'no_participant_match');

  console.log(`\nLoaded ${rows.length} unmatched EPA entries from ${path.basename(inputPath)}`);
  console.log(`  no_score             : ${noScore.length}  (auto-skipped)`);
  console.log(`  no_participant_match : ${noMatch.length}  (need manual assignment)`);
  if (unrecognised.length) console.log(`  unrecognised reason  : ${unrecognised.length}  (auto-skipped)`);

  if (!noMatch.length) {
    console.log('\nNothing to resolve. Exiting.\n');
    await conn.end(); return;
  }

  console.log('\nFor each entry you will see the extracted name and scores, then a');
  console.log('list of trainees assigned to that report. Enter the number of the');
  console.log('correct trainee, [m] to manually search for/enter a trainee not');
  console.log('listed, or [s] to skip if the score does not belong to any of them.\n');

  let written = 0, alreadyExists = 0, skipped = 0, manuallyResolved = 0;

  outer:
  for (let i = 0; i < noMatch.length; i++) {
    const { reportId, rawName, epas } = noMatch[i];
    const epaList = (epas || '').split('|').map(Number).filter(n => !isNaN(n) && n >= 1 && n <= 5);

    console.log('─'.repeat(60));
    console.log(`[${i + 1}/${noMatch.length}]  Report: ${reportId}`);
    console.log(`  Extracted name   : "${rawName || '(none)'}"`);
    console.log(`  Extracted scores : ${epaList.length ? epaList.join(', ') : '(none)'}`);

    if (!epaList.length) {
      console.log('  No valid scores to assign — skipping.\n');
      skipped++;
      continue;
    }

    const trainees = await getTraineesForReport(conn, reportId);

    if (trainees.length) {
      console.log('\n  Trainees on this report:');
      trainees.forEach((t, idx) =>
        console.log(`    [${idx}] ${(t.first_name || '?')} ${(t.last_name || '?')}  (source: "${t.source_text}"  id: ${t.id})`)
      );
    } else {
      console.log('\n  No trainee participants found for this report.');
    }
    console.log('    [m] manually search for / enter a trainee not listed above');
    console.log('    [s] skip — score does not belong to any of these trainees');
    console.log('    [q] quit\n');

    let picked = null;

    while (picked === null) {
      const choice = await ask(`  Assign score(s) [${epaList.join(', ')}] to which trainee? `);

      if (choice === 'q') {
        console.log('\nQuitting early.\n');
        break outer;
      }

      if (choice === 's') {
        console.log('  Skipped.\n');
        skipped++;
        continue outer;
      }

      if (choice === 'm') {
        const manual = await manualEntryFlow(conn, reportId, rawName);
        if (manual) {
          picked = { id: manual.id, name: `${manual.first_name || '?'} ${manual.last_name || '?'}` };
          manuallyResolved++;
        } else {
          console.log('  Back to trainee selection.\n');
        }
        continue;
      }

      const idx = Number(choice);
      if (isNaN(idx) || !trainees[idx]) {
        console.log('  Invalid selection — try again, [m] to search manually, or [s] to skip.\n');
        continue;
      }

      picked = {
        id: trainees[idx].id,
        name: `${trainees[idx].first_name || '?'} ${trainees[idx].last_name || '?'}`,
      };
    }

    for (const score of epaList) {
      const ok = await writeScore(conn, picked.id, score);
      if (ok) {
        written++;
        console.log(`  → Written  score ${score}  →  ${picked.name} (id: ${picked.id})`);
      } else {
        alreadyExists++;
        console.log(`  → Score ${score} already exists for ${picked.name} — skipped.`);
      }
    }
    console.log('');
  }

  await conn.end();

  const W = 60;
  console.log('═'.repeat(W));
  console.log('  MANUAL EPA RESOLVE COMPLETE');
  console.log('─'.repeat(W));
  console.log(`  Entries reviewed        : ${noMatch.length}`);
  console.log(`  Scores written          : ${written}`);
  console.log(`  Already existed         : ${alreadyExists}`);
  console.log(`  Resolved via manual entry : ${manuallyResolved}`);
  console.log(`  Skipped                 : ${skipped}`);
  console.log(`  Auto-skipped (no_score) : ${noScore.length}`);
  console.log('═'.repeat(W) + '\n');
}

main().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });