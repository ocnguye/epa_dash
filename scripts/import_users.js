#!/usr/bin/env node
/**
 * scripts/import_users_excel.js
 *
 * Imports users from an Excel file with two sheets:
 *   - import_attendings
 *   - import_trainee
 *
 * Behavior:
 *   - Prevents duplicate users (matches on username OR first+last name)
 *   - Updates existing users ONLY if new fields differ (e.g., pgy)
 *   - Never overwrites first_name / last_name
 *   - Supports --dry-run mode to preview changes
 *
 * Usage:
 *   node scripts/import_users_excel.js /path/to/file.xlsx --dry-run
 *   node scripts/import_users_excel.js /path/to/file.xlsx --write
 *
 * Rules:
 *   - If user exists → update only missing/new info (e.g. pgy)
 *   - If no user → insert
 *   - Matching priority:
 *       1. username
 *       2. first_name + last_name
 *
 * Required env vars:
 *   AWS_RDS_HOST, AWS_RDS_USER, AWS_RDS_PWD, AWS_RDS_DB
 *   AWS_RDS_PORT (optional)
 */

'use strict';

require('dotenv').config();

const mysql = require('mysql2/promise');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const xlsx = require('xlsx');

// ─────────────────────────────────────────────
// DB CONFIG
// ─────────────────────────────────────────────

function getDbConfig() {
  return {
    host: process.env.AWS_RDS_HOST,
    user: process.env.AWS_RDS_USER,
    password: process.env.AWS_RDS_PWD,
    database: process.env.AWS_RDS_DB,
    port: Number(process.env.AWS_RDS_PORT || 3306),
  };
}

// ─────────────────────────────────────────────
// USER RESOLUTION
// ─────────────────────────────────────────────

async function findUser(conn, username, first, last) {
  if (username) {
    const [rows] = await conn.execute(
      `SELECT * FROM users WHERE username = ? LIMIT 1`,
      [username]
    );
    if (rows.length) return rows[0];
  }

  if (first && last) {
    const [rows] = await conn.execute(
      `SELECT * FROM users WHERE first_name = ? AND last_name = ? LIMIT 1`,
      [first, last]
    );
    if (rows.length) return rows[0];
  }

  return null;
}

// ─────────────────────────────────────────────
// UPSERT LOGIC
// ─────────────────────────────────────────────

function buildUpdateFields(existing, incoming) {
  const updates = [];
  const values = [];

  for (const key of Object.keys(incoming)) {
    if (incoming[key] == null) continue;

    // NEVER overwrite name mismatch protection
    if ((key === 'first_name' || key === 'last_name') && existing[key] !== incoming[key]) {
      continue;
    }

    if (existing[key] !== incoming[key]) {
      updates.push(`${key} = ?`);
      values.push(incoming[key]);
    }
  }

  return { updates, values };
}

async function upsertUser(conn, row, dryRun) {
  const { first_name, last_name, username, password, role, pgy } = row;

  const existing = await findUser(conn, username, first_name, last_name);

  // ─── INSERT ─────────────────────────────────────────────
  if (!existing) {
    if (dryRun) {
      console.log(`[DRY] INSERT user: ${username || first_name + ' ' + last_name}`);
      return 'insert';
    }

    await conn.execute(
      `INSERT INTO users (first_name, last_name, username, password, role, pgy)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [first_name, last_name, username, password, role, pgy || null]
    );

    console.log(`[INSERT] ${username || first_name + ' ' + last_name}`);
    return 'insert';
  }

  // ─── UPDATE LOGIC ───────────────────────────────────────
  const { updates, values } = buildUpdateFields(existing, row);

  if (updates.length === 0) {
    console.log(`[SKIP] ${username || first_name + ' ' + last_name} (no changes)`);
    return 'skip';
  }

  if (dryRun) {
    console.log(`[DRY] UPDATE ${username || first_name + ' ' + last_name}: ${updates.join(', ')}`);
    return 'update';
  }

  await conn.execute(
    `UPDATE users SET ${updates.join(', ')} WHERE user_id = ?`,
    [...values, existing.user_id]
  );

  console.log(`[UPDATE] ${username || first_name + ' ' + last_name}`);
  return 'update';
}

// ─────────────────────────────────────────────
// SHEET PROCESSING
// ─────────────────────────────────────────────

function processSheet(sheet, roleOverride = null) {
  const rows = xlsx.utils.sheet_to_json(sheet);

  return rows.map(r => ({
    first_name: r.first_name || r.FirstName || null,
    last_name: r.last_name || r.LastName || null,
    username: r.username || r.Username || null,
    password: r.password || r.Password || null,
    role: roleOverride || r.role || null,
    pgy: r.pgy || r.PGY || null,
  }));
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────

async function main() {
  const argv = yargs(hideBin(process.argv))
    .usage('node scripts/import_users_excel.js <file> [--dry-run|--write]')
    .demandCommand(1)
    .option('dry-run', { type: 'boolean', default: false })
    .option('write', { type: 'boolean', default: false })
    .check(argv => {
      if (!argv['dry-run'] && !argv.write) {
        throw new Error('Must pass --dry-run or --write');
      }
      if (argv['dry-run'] && argv.write) {
        throw new Error('--dry-run and --write cannot be used together');
      }
      return true;
    })
    .argv;

  const filePath = argv._[0];
  const wb = xlsx.readFile(filePath);

  const attendingsSheet = wb.Sheets['import_attendings'];
  const traineeSheet = wb.Sheets['import_trainees'];

  if (!attendingsSheet || !traineeSheet) {
    throw new Error('Missing required sheets: import_attendings or import_trainees');
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  const attendings = processSheet(attendingsSheet, 'attending');
  const trainees = processSheet(traineeSheet, 'trainee');

  const conn = await mysql.createConnection(getDbConfig());

  console.log(`\nProcessing attendings: ${attendings.length}`);
  for (const row of attendings) {
    const result = await upsertUser(conn, row, argv['dry-run']);
    if (result === 'insert') inserted++;
    else if (result === 'update') updated++;
    else if (result === 'skip') skipped++;
  }

  console.log(`\nProcessing trainees: ${trainees.length}`);
  for (const row of trainees) {
    const result = await upsertUser(conn, row, argv['dry-run']);
    if (result === 'insert') inserted++;
    else if (result === 'update') updated++;
    else if (result === 'skip') skipped++;
  }

  console.log('\n──────── SUMMARY ────────');
  console.log(`Inserted: ${inserted}`);
  console.log(`Updated : ${updated}`);
  console.log(`Skipped : ${skipped}`);
  console.log('─────────────────────────\n');

  await conn.end();

  console.log('\nDone.');
}

if (require.main === module) {
  main().catch(err => {
    console.error('[FATAL]', err.message);
    process.exit(1);
  });
}