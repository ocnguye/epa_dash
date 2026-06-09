#!/usr/bin/env node
/**
 * scripts/sync_report_fields.js
 *
 * Syncs reports.trainee and reports.attending with resolved user_ids
 * from report_participants.
 *
 * Usage:
 *   node scripts/sync_report_fields.js --dry-run
 *   node scripts/sync_report_fields.js --write
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

  // Fetch all resolved participants grouped by report and role
  const [rows] = await conn.execute(`
    SELECT report_id, role, GROUP_CONCAT(user_id ORDER BY user_id SEPARATOR ';') AS mapped_ids
    FROM report_participants
    WHERE user_id IS NOT NULL
    GROUP BY report_id, role
  `);

  // Pivot into a map: reportId → { attending, trainee }
  const byReport = new Map();
  for (const row of rows) {
    if (!byReport.has(row.report_id)) byReport.set(row.report_id, {});
    byReport.get(row.report_id)[row.role] = row.mapped_ids;
  }

  console.log(`[INFO] ${byReport.size} reports have resolved participants.`);

  if (argv['dry-run']) {
    console.log('\n' + '═'.repeat(72));
    console.log('  DRY-RUN — proposed updates');
    console.log('═'.repeat(72));
    for (const [reportId, fields] of byReport) {
      const parts = [];
      if (fields.attending) parts.push(`attending=${fields.attending}`);
      if (fields.trainee)   parts.push(`trainee=${fields.trainee}`);
      console.log(`  ReportID ${reportId}: ${parts.join('  |  ')}`);
    }
    console.log('═'.repeat(72));
    console.log(`\n  Would update ${byReport.size} reports. Run with --write to commit.\n`);
    await conn.end();
    return;
  }

  // Write
  let updated = 0, errors = 0;
  for (const [reportId, fields] of byReport) {
    const setClauses = [];
    const params = [];
    if (fields.attending !== undefined) { setClauses.push('attending = ?'); params.push(fields.attending); }
    if (fields.trainee   !== undefined) { setClauses.push('trainee = ?');   params.push(fields.trainee);   }
    if (!setClauses.length) continue;
    params.push(reportId);
    try {
      await conn.execute(`UPDATE reports SET ${setClauses.join(', ')} WHERE ReportID = ?`, params);
      updated++;
    } catch(e) {
      errors++;
      console.error(`[ERROR] ReportID ${reportId}: ${e.message}`);
    }
  }

  await conn.end();

  console.log('\n' + '═'.repeat(72));
  console.log('  SYNC COMPLETE');
  console.log('─'.repeat(72));
  console.log(`  Reports updated : ${updated}`);
  if (errors) console.log(`  Errors          : ${errors}`);
  console.log('═'.repeat(72) + '\n');
}

main().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });