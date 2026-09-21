#!/usr/bin/env node
/**
 * scripts/audit_users.js
 *
 * READ-ONLY. Cross-checks the `users` table against the master Excel
 * sheet (import_attendings / import_trainees) and reports exactly
 * where the counts diverge. Makes no changes to the database.
 *
 * Usage:
 *   node scripts/audit_users_excel.js /path/to/file.xlsx
 *
 * What it reports:
 *   1. Total DB users vs. total sheet rows, broken out by role.
 *   2. DB users with a role outside attending/trainee (e.g. admin) —
 *      these are expected to NOT be in this sheet, so they're just
 *      shown for context, not flagged as a problem.
 *   3. DB users (role attending/trainee) whose username does not
 *      appear anywhere in the sheet — "in DB, not in sheet."
 *   4. Sheet rows whose username does not match any DB user —
 *      "in sheet, not in DB" (would mean a prior import missed them).
 *   5. Duplicate usernames found within the DB itself.
 *   6. Duplicate usernames found within the sheet itself.
 *
 * Required env vars:
 *   AWS_RDS_HOST, AWS_RDS_USER, AWS_RDS_PWD, AWS_RDS_DB
 *   AWS_RDS_PORT (optional)
 */

'use strict';

require('dotenv').config();

const mysql = require('mysql2/promise');
const xlsx = require('xlsx');

function getDbConfig() {
  return {
    host: process.env.AWS_RDS_HOST,
    user: process.env.AWS_RDS_USER,
    password: process.env.AWS_RDS_PWD,
    database: process.env.AWS_RDS_DB,
    port: Number(process.env.AWS_RDS_PORT || 3306),
  };
}

function processSheet(sheet, roleOverride) {
  const rows = xlsx.utils.sheet_to_json(sheet);
  return rows.map(r => ({
    first_name: r.first_name || r.FirstName || null,
    last_name: r.last_name || r.LastName || null,
    username: r.username || r.Username || null,
    role: roleOverride || r.role || null,
    pgy: r.pgy || r.PGY || null,
  }));
}

function findDupes(items, keyFn) {
  const seen = new Map();
  const dupes = new Set();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    if (seen.has(key)) dupes.add(key);
    seen.set(key, true);
  }
  return [...dupes];
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node scripts/audit_users_excel.js /path/to/file.xlsx');
    process.exit(1);
  }

  const wb = xlsx.readFile(filePath);
  const attendingsSheet = wb.Sheets['import_attendings'];
  const traineeSheet = wb.Sheets['import_trainees'];

  if (!attendingsSheet || !traineeSheet) {
    throw new Error('Missing required sheets: import_attendings or import_trainees');
  }

  const sheetRows = [
    ...processSheet(attendingsSheet, 'attending'),
    ...processSheet(traineeSheet, 'trainee'),
  ];

  const conn = await mysql.createConnection(getDbConfig());
  const [dbRows] = await conn.execute(
    `SELECT user_id, first_name, last_name, username, role, pgy FROM users`
  );
  await conn.end();

  // ─── Counts ─────────────────────────────────────────────
  const dbByRole = {};
  for (const u of dbRows) dbByRole[u.role] = (dbByRole[u.role] || 0) + 1;

  const sheetByRole = {};
  for (const r of sheetRows) sheetByRole[r.role] = (sheetByRole[r.role] || 0) + 1;

  console.log('──────── COUNTS ────────');
  console.log(`DB total users   : ${dbRows.length}`);
  for (const [role, count] of Object.entries(dbByRole)) {
    console.log(`  role=${role.padEnd(10)}: ${count}`);
  }
  console.log(`Sheet total rows : ${sheetRows.length}`);
  for (const [role, count] of Object.entries(sheetByRole)) {
    console.log(`  role=${role.padEnd(10)}: ${count}`);
  }
  console.log('');

  // Roles in the DB that this sheet doesn't cover at all (e.g. admin)
  // — expected, just shown for context.
  const trackedRoles = new Set(['attending', 'trainee']);
  const otherRoleUsers = dbRows.filter(u => !trackedRoles.has(u.role));
  if (otherRoleUsers.length) {
    console.log(`──────── DB USERS OUTSIDE attending/trainee (${otherRoleUsers.length}) ────────`);
    console.log('(Not expected to be in this sheet — shown for context only)');
    for (const u of otherRoleUsers) {
      console.log(`  ${u.username || `${u.first_name} ${u.last_name}`} — role=${u.role}`);
    }
    console.log('');
  }

  // ─── DB users not represented in the sheet ─────────────
  const sheetUsernames = new Set(
    sheetRows.filter(r => r.username).map(r => r.username)
  );
  const dbNotInSheet = dbRows.filter(
    u => trackedRoles.has(u.role) && !sheetUsernames.has(u.username)
  );

  console.log(`──────── IN DB, NOT IN SHEET (${dbNotInSheet.length}) ────────`);
  if (!dbNotInSheet.length) {
    console.log('  none');
  } else {
    for (const u of dbNotInSheet) {
      console.log(`  ${u.username} — ${u.first_name} ${u.last_name} (role=${u.role}, pgy=${u.pgy ?? '—'})`);
    }
  }
  console.log('');

  // ─── Sheet rows not represented in the DB ──────────────
  const dbUsernames = new Set(dbRows.map(u => u.username).filter(Boolean));
  const sheetNotInDb = sheetRows.filter(
    r => r.username && !dbUsernames.has(r.username)
  );
  const sheetNoUsername = sheetRows.filter(r => !r.username);

  console.log(`──────── IN SHEET, NOT IN DB (${sheetNotInDb.length}) ────────`);
  if (!sheetNotInDb.length) {
    console.log('  none');
  } else {
    for (const r of sheetNotInDb) {
      console.log(`  ${r.username} — ${r.first_name} ${r.last_name} (role=${r.role})`);
    }
  }
  if (sheetNoUsername.length) {
    console.log(`  (+ ${sheetNoUsername.length} sheet row(s) with no username at all — can't be matched this way)`);
    for (const r of sheetNoUsername) {
      console.log(`    ${r.first_name} ${r.last_name} (role=${r.role})`);
    }
  }
  console.log('');

  // ─── Duplicate usernames ────────────────────────────────
  const dbDupes = findDupes(dbRows, u => u.username);
  const sheetDupes = findDupes(sheetRows, r => r.username);

  console.log(`──────── DUPLICATE USERNAMES IN DB (${dbDupes.length}) ────────`);
  if (!dbDupes.length) {
    console.log('  none');
  } else {
    for (const username of dbDupes) {
      const matches = dbRows.filter(u => u.username === username);
      console.log(`  "${username}" appears ${matches.length}x:`);
      for (const m of matches) console.log(`    user_id=${m.user_id} ${m.first_name} ${m.last_name} (role=${m.role})`);
    }
  }
  console.log('');

  console.log(`──────── DUPLICATE USERNAMES IN SHEET (${sheetDupes.length}) ────────`);
  if (!sheetDupes.length) {
    console.log('  none');
  } else {
    for (const username of sheetDupes) {
      console.log(`  "${username}" appears more than once in the sheet`);
    }
  }
  console.log('');

  console.log('Done.');
}

main().catch(err => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});