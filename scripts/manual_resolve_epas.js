#!/usr/bin/env node
/**
 * scripts/manual_resolve_epa.js
 *
 * Interactive CLI to manually assign EPA scores from unmatched_epas.csv.
 * Handles two cases:
 *   1. reason=no_participant_match  — score was found but no trainee participant
 *      row matched the name. Lets you pick the correct participant by report.
 *   2. reason=no_score             — participant is known but EPA label was NR
 *      or missing. Lets you enter the score manually.
 *
 * Usage:
 *   node scripts/manual_resolve_epa.js output/unmatched_epas.csv
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
  const raw = fs.readFileSync(filePath,'utf8').split('\n').map(l=>l.trim()).filter(Boolean);
  const headers = raw[0].split(',');
  return raw.slice(1).map(line => {
    const cols=[]; let cur='',inQ=false;
    for (const ch of line) {
      if (ch==='"'){inQ=!inQ;}
      else if (ch===','&&!inQ){cols.push(cur);cur='';}
      else cur+=ch;
    }
    cols.push(cur);
    const obj={}; headers.forEach((h,i)=>obj[h.trim()]=(cols[i]||'').trim());
    return obj;
  });
}

function ask(query) {
  const rl=readline.createInterface({input:process.stdin,output:process.stdout});
  return new Promise(resolve=>rl.question(query,ans=>{rl.close();resolve(ans.trim());}));
}

async function getTraineesForReport(conn, reportId) {
  const [rows] = await conn.execute(
    `SELECT rp.id, rp.source_text, u.first_name, u.last_name
     FROM report_participants rp
     LEFT JOIN users u ON u.user_id = rp.user_id
     WHERE rp.report_id = ? AND rp.role = 'trainee'`,
    [reportId]
  );
  return rows;
}

async function scoreExists(conn, participantId, score) {
  const [rows] = await conn.execute(
    `SELECT id FROM epa_scores WHERE report_participant_id=${Number(participantId)} AND epa_score=${Number(score)}`
  );
  return rows.length > 0;
}

async function writeScore(conn, participantId, score) {
  const exists = await scoreExists(conn, participantId, score);
  if (exists) return false;
  await conn.execute(
    `INSERT INTO epa_scores (report_participant_id, epa_score) VALUES (${Number(participantId)}, ${Number(score)})`
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
    const conn = await mysql.createConnection(getRdsConfig());
    const rows = loadCSV(inputPath);
    console.log(`\nLoaded ${rows.length} unmatched EPA entries from ${inputPath}\n`);

  let written=0, skipped=0, alreadyExists=0;

  for (const row of rows) {
    const {reportId, participantId, reason, rawName, epas} = row;

    console.log('\n'+'─'.repeat(60));
    console.log(`Report: ${reportId}  Reason: ${reason}`);
    if (rawName) console.log(`Extracted name: "${rawName}"`);
    if (epas)    console.log(`Extracted scores: ${epas}`);

    // ── Case 1: no_score — participant known, score missing ─────────────────
    if (reason === 'no_score' && participantId) {
      const [pRows] = await conn.execute(
        `SELECT rp.id, rp.source_text, u.first_name, u.last_name
         FROM report_participants rp LEFT JOIN users u ON u.user_id=rp.user_id
         WHERE rp.id=?`, [participantId]
      );
      const p = pRows[0];
      if (p) console.log(`Participant: ${p.first_name||''} ${p.last_name||''} (source: "${p.source_text}", id=${participantId})`);

      const ans = await ask('  Enter EPA score (1-5), [s] skip, [q] quit: ');
      if (ans==='q') break;
      if (ans==='s') { skipped++; continue; }
      const score = Number(ans);
      if (isNaN(score)||score<1||score>5) { console.log('  Invalid score.'); skipped++; continue; }
      const ok = await writeScore(conn, Number(participantId), score);
      if (ok) { written++; console.log(`  → Written score ${score} for participant ${participantId}`); }
      else { alreadyExists++; console.log('  → Already exists, skipped.'); }
      continue;
    }

    // ── Case 2: no_participant_match — score found but name didn't match ─────
    if (reason === 'no_participant_match') {
      const epaList = (epas||'').split('|').map(Number).filter(n=>!isNaN(n)&&n>=1&&n<=5);
      if (!epaList.length) { console.log('  No valid scores to assign.'); skipped++; continue; }

      const trainees = await getTraineesForReport(conn, reportId);
      if (!trainees.length) {
        console.log('  No trainee participants found for this report — skipping.');
        skipped++; continue;
      }

      trainees.forEach((t,i)=>
        console.log(`  [${i}] ${t.first_name||'?'} ${t.last_name||'?'}  source="${t.source_text}"  id=${t.id}`)
      );
      console.log('  [s] skip  [q] quit');

      const choice = await ask(`  Assign scores [${epaList.join(',')}] to which participant? `);
      if (choice==='q') break;
      if (choice==='s') { skipped++; continue; }
      const idx = Number(choice);
      if (isNaN(idx)||!trainees[idx]) { console.log('  Invalid.'); skipped++; continue; }
      const pid = trainees[idx].id;
      for (const score of epaList) {
        const ok = await writeScore(conn, pid, score);
        if (ok) { written++; console.log(`  → Written score ${score} for participant ${pid}`); }
        else { alreadyExists++; console.log(`  → Score ${score} already exists.`); }
      }
      continue;
    }

    console.log('  Unrecognised reason, skipping.');
    skipped++;
  }

  await conn.end();

  console.log('\n'+'═'.repeat(60));
  console.log('  MANUAL EPA RESOLVE COMPLETE');
  console.log('─'.repeat(60));
  console.log(`  Scores written        : ${written}`);
  console.log(`  Already existed       : ${alreadyExists}`);
  console.log(`  Skipped               : ${skipped}`);
  console.log('═'.repeat(60)+'\n');
}

main().catch(e=>{console.error('[FATAL]',e.message);process.exit(1);});