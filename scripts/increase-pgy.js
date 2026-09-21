#!/usr/bin/env node
/**
 * scripts/increase_pgy.js
 *
 * Two modes:
 *
 * 1) Increment mode (default)
 *    Increments every user's PGY by 1 and records a status note in the
 *    `pgy_note` column:
 *      - new PGY > 7    -> "Graduated"
 *      - new PGY === 6  -> "PGY 6 - first-year"
 *      - new PGY === 7  -> "PGY 7 - second-year"
 *      - anything else  -> pgy_note cleared (NULL)
 *
 * 2) Sync mode (--sync-notes)
 *    Leaves PGY untouched and recomputes pgy_note from each user's CURRENT
 *    PGY using the same rules as above. Only rows whose note differs from
 *    the expected value are updated. Use this to repair inconsistent notes.
 *
 * Usage:
 *   node scripts/increase_pgy.js --dry-run
 *   node scripts/increase_pgy.js --write
 *   node scripts/increase_pgy.js --sync-notes --dry-run
 *   node scripts/increase_pgy.js --sync-notes --write
 *
 * NOTE: --write WITHOUT --sync-notes increments everyone's PGY.
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
// NOTE LOGIC
// ─────────────────────────────────────────────

function noteFor(pgy) {
  if (pgy > 7) return 'Graduated';
  if (pgy === 6) return 'PGY 6 - first-year';
  if (pgy === 7) return 'PGY 7 - second-year';
  return null;
}

// ─────────────────────────────────────────────
// SCHEMA
// ─────────────────────────────────────────────

async function ensurePgyNoteColumn(conn, dryRun) {
  const [rows] = await conn.execute(
    `SELECT COUNT(*) AS cnt
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'users'
        AND COLUMN_NAME = 'pgy_note'`
  );

  if (rows[0].cnt > 0) return;

  if (dryRun) {
    console.log('[DRY] ALTER TABLE users ADD COLUMN pgy_note VARCHAR(255) NULL');
    return;
  }

  console.log('[SCHEMA] Adding pgy_note column...');
  await conn.execute(`ALTER TABLE users ADD COLUMN pgy_note VARCHAR(255) NULL`);
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────

async function main() {
  const argv = yargs(hideBin(process.argv))
    .usage('node scripts/increase_pgy.js [--dry-run|--write] [--sync-notes]')
    .option('dry-run', { type: 'boolean', default: false })
    .option('write', { type: 'boolean', default: false })
    .option('sync-notes', {
      type: 'boolean',
      default: false,
      describe: 'Recompute pgy_note from current PGY without changing PGY',
    })
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

  const dryRun = argv['dry-run'];
  const syncOnly = argv['sync-notes'];

  const conn = await mysql.createConnection(getDbConfig());

  let updated = 0;
  let unchanged = 0;

  try {
    await ensurePgyNoteColumn(conn, dryRun);

    const [users] = await conn.execute(
      `SELECT user_id, username, first_name, last_name, pgy, pgy_note
         FROM users
        WHERE pgy IS NOT NULL`
    );

    if (users.length === 0) {
      console.log('No users with a non-null PGY found.');
      return;
    }

    console.log(`\nMode: ${syncOnly ? 'SYNC NOTES ONLY' : 'INCREMENT PGY'}${dryRun ? ' (dry run)' : ''}`);
    console.log(`Processing users: ${users.length}`);

    if (!dryRun) await conn.beginTransaction();

    for (const u of users) {
      const label = u.username || `${u.first_name} ${u.last_name}`;

      // ── Sync-only mode: fix the note, leave PGY alone ──
      if (syncOnly) {
        const note = noteFor(u.pgy);

        if ((u.pgy_note ?? null) === note) {
          unchanged++;
          continue;
        }

        if (dryRun) {
          console.log(
            `[DRY] SYNC ${label}: PGY ${u.pgy}, pgy_note "${u.pgy_note ?? 'NULL'}" -> "${note ?? 'NULL'}"`
          );
        } else {
          await conn.execute(
            `UPDATE users SET pgy_note = ? WHERE user_id = ?`,
            [note, u.user_id]
          );
          console.log(`[SYNC] ${label}: PGY ${u.pgy}, pgy_note -> "${note ?? 'NULL'}"`);
        }
        updated++;
        continue;
      }

      // ── Increment mode ──
      const newPgy = u.pgy + 1;
      const note = noteFor(newPgy);

      if (dryRun) {
        console.log(
          `[DRY] UPDATE ${label}: pgy ${u.pgy} -> ${newPgy}` +
          (note ? `, pgy_note = "${note}"` : ', pgy_note cleared')
        );
      } else {
        await conn.execute(
          `UPDATE users SET pgy = ?, pgy_note = ? WHERE user_id = ?`,
          [newPgy, note, u.user_id]
        );
        console.log(`[UPDATE] ${label}: pgy ${u.pgy} -> ${newPgy}`);
      }
      updated++;
    }

    if (!dryRun) await conn.commit();

    console.log('\n──────── SUMMARY ────────');
    console.log(`${dryRun ? 'Would update' : 'Updated'}: ${updated}`);
    if (syncOnly) console.log(`Already correct: ${unchanged}`);
    console.log('─────────────────────────\n');
  } catch (err) {
    if (!dryRun) await conn.rollback();
    console.error('[FATAL]', err.message);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }

  console.log('\nDone.');
}

if (require.main === module) {
  main().catch(err => {
    console.error('[FATAL]', err.message);
    process.exit(1);
  });
}