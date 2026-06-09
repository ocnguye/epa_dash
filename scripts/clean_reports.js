#!/usr/bin/env node
/**
 * scripts/clear_unresolved_fields.js
 *
 * NULLs out reports.trainee and reports.attending where the value
 * is not a valid resolved user_id assignment (i.e. not purely digits
 * and semicolons).
 *
 * Usage:
 *   node scripts/clear_unresolved_fields.js --dry-run
 *   node scripts/clear_unresolved_fields.js --write
 */

'use strict';

require('dotenv').config();

const mysql = require('mysql2/promise');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

function getRdsConfig() {
  const host = process.env.AWS_RDS_HOST, user = process.env.AWS_RDS_USER,
        password = process.env.AWS_RDS_PWD, database = process.env.AWS_RDS_DB,
        port = Number(process.env.AWS_RDS_PORT || 3306);
  if (!host || !user || !password || !database)
    throw new Error('Missing env vars: AWS_RDS_HOST, AWS_RDS_USER, AWS_RDS_PWD, AWS_RDS_DB');
  return { host, user, password, database, port, multipleStatements: false };
}

// A valid value is either NULL already, or contains only digits and semicolons.
function isResolved(val) {
  if (val === null || val === undefined) return true;
  return /^[0-9;]+$/.test(String(val).trim());
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option('dry-run', { type: 'boolean', default: false })
    .option('write',   { type: 'boolean', default: false })
    .check(argv => {
      if (!argv['dry-run'] && !argv.write) throw new Error('Pass --dry-run or --write.');
      if (argv['dry-run'] && argv.write)   throw new Error('--dry-run and --write are mutually exclusive.');
      return true;
    }).argv;

  let conn;
  try { conn = await mysql.createConnection(getRdsConfig()); }
  catch(e) { console.error('[FATAL]', e.message); process.exit(1); }

  const [rows] = await conn.execute(
    `SELECT ReportID, trainee, attending FROM reports
     WHERE trainee  REGEXP '[^0-9;]'
        OR attending REGEXP '[^0-9;]'`
  );

  console.log(`[INFO] ${rows.length} reports have unresolved trainee or attending values.`);

  if (!rows.length) {
    console.log('[INFO] Nothing to do.');
    await conn.end();
    return;
  }

  if (argv['dry-run']) {
    console.log('\n' + '═'.repeat(72));
    console.log('  DRY-RUN — fields that would be NULLed');
    console.log('═'.repeat(72));
    let traineeCount = 0, attendingCount = 0;
    for (const r of rows) {
      const parts = [];
      if (!isResolved(r.trainee))   { parts.push(`trainee="${r.trainee}"`);     traineeCount++;   }
      if (!isResolved(r.attending)) { parts.push(`attending="${r.attending}"`); attendingCount++; }
      if (parts.length) console.log(`  ReportID ${r.ReportID}: ${parts.join('  |  ')}`);
    }
    console.log('─'.repeat(72));
    console.log(`  trainee fields to NULL  : ${traineeCount}`);
    console.log(`  attending fields to NULL: ${attendingCount}`);
    console.log('═'.repeat(72));
    console.log('\n  Run with --write to commit.\n');
    await conn.end();
    return;
  }

  // Write
  let updated = 0, errors = 0;
  for (const r of rows) {
    const setClauses = [];
    if (!isResolved(r.trainee))   setClauses.push('trainee = NULL');
    if (!isResolved(r.attending)) setClauses.push('attending = NULL');
    if (!setClauses.length) continue;

    try {
      await conn.execute(
        `UPDATE reports SET ${setClauses.join(', ')} WHERE ReportID = ?`,
        [r.ReportID]
      );
      updated++;
    } catch(e) {
      errors++;
      console.error(`[ERROR] ReportID ${r.ReportID}: ${e.message}`);
    }
  }

  await conn.end();

  console.log('\n' + '═'.repeat(72));
  console.log('  CLEAR UNRESOLVED FIELDS COMPLETE');
  console.log('─'.repeat(72));
  console.log(`  Reports updated : ${updated}`);
  if (errors) console.log(`  Errors          : ${errors}`);
  console.log('═'.repeat(72) + '\n');
  console.log('Next: node scripts/sync_report_fields.js --write\n');
}

main().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });