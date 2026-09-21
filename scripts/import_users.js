#!/usr/bin/env node
/**
 * scripts/import_users.js
 *
 * Imports users from an Excel file with two sheets:
 *   - import_attendings
 *   - import_trainees
 *
 * The sheet is treated as the source of truth. Behavior:
 *   - Prevents duplicate users (matches on username, or on first+last
 *     name WITHIN THE SAME ROLE when no username is given)
 *   - A person who is both an attending and a trainee is expected to
 *     have TWO separate accounts with DIFFERENT usernames. The script
 *     never merges an attending row into a trainee record (or vice
 *     versa) just because the name matches.
 *   - Updates existing users ONLY if a field's new value differs from
 *     what's stored. Rows with no actual change are skipped.
 *   - Normally never overwrites first_name / last_name — EXCEPT when
 *     resolving a username collision (see below), where the sheet
 *     wins and the stored name is corrected to match it.
 *   - Passwords are NEVER overwritten on an update, no matter what.
 *     The master sheet carries a dummy password ("123" by default)
 *     for everyone, so an existing user's real password must never
 *     be clobbered by that. Passwords ARE used when creating a brand
 *     new user (insert) — whatever the sheet has for that row,
 *     dummy "123" or a real one, becomes that new user's password.
 *   - Supports --dry-run mode that prints exactly what would change,
 *     field by field, without touching the database.
 *
 * Matching rules (in order):
 *   1. username match -> that IS the target record.
 *        - If the first/last name on that record doesn't match the
 *          incoming row, the sheet is treated as authoritative: the
 *          stored first_name/last_name are corrected to match the
 *          sheet.
 *            - If the only difference is cosmetic (capitalization or
 *              extra/missing whitespace — e.g. "john smith " vs
 *              "John Smith"), this is logged as a normal [UPDATE].
 *            - If the names are substantively different even after
 *              normalizing case/whitespace (e.g. "John Smith" vs
 *              "Jon Smyth"), this is logged distinctly as
 *              [CONFLICT-RESOLVED] — worth a second look, since it
 *              usually means the same username was reused for what
 *              might be two different people, or there's a typo
 *              somewhere in the sheet.
 *   2. no username on the incoming row -> fall back to
 *        first_name + last_name + role match (same role only).
 *        - If a name match exists but only under a DIFFERENT role,
 *          the script does NOT guess. It fails loudly (non-zero
 *          exit, clear error identifying the row) instead of
 *          silently skipping, because the sheet is required to
 *          always include a username for any person who has, or is
 *          getting, more than one account. Fix the sheet and rerun.
 *   3. no match at all -> insert as a new user.
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

// Fields we NEVER auto-diff/update on an existing user. The master
// sheet carries a dummy password ("123") for everyone, so password
// must never flow from the sheet into an UPDATE — only into a fresh
// INSERT. This is not configurable; there is no flag to opt back in.
const NEVER_UPDATE_FIELDS = new Set(['password']);

class AmbiguousCrossRoleError extends Error {}

// Normalizes a name for "is this really the same name" comparisons:
// trims, collapses internal whitespace, and lowercases. Used only to
// decide whether a name mismatch is cosmetic vs. substantive — the
// value actually written to the DB always comes verbatim from the
// sheet either way.
function normalizeName(s) {
  return (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// ─────────────────────────────────────────────
// USER RESOLUTION
// ─────────────────────────────────────────────

/**
 * Attempts to resolve an incoming row to an existing DB user.
 *
 * In write mode, `pending` is always empty because every insert is
 * committed immediately, so a later row's DB query already sees it.
 * In dry-run mode nothing is ever committed, so `pending` carries the
 * simulated "would-be inserted" users from earlier rows in this same
 * run — otherwise a dry-run of a sheet where row 2 depends on row 1
 * (e.g. two rows for the same new person, one attending one trainee)
 * would silently diverge from what --write would actually do.
 *
 * Returns { existing, matchType, nameOverwrite } where:
 *   matchType: 'username' | 'name_role' | null
 *   nameOverwrite: { from: {first_name,last_name}, to: {first_name,last_name}, cosmeticOnly } | null
 *     — set when a username match was found under a different name,
 *       meaning the sheet's name should overwrite what's stored.
 *
 * Throws AmbiguousCrossRoleError if a no-username row's name matches
 * an existing (or pending) user that exists only under a different
 * role — the sheet must supply a username in that case, so we refuse
 * to guess.
 */
async function resolveUser(conn, row, pending) {
  const { username, first_name, last_name, role } = row;

  if (username) {
    const [rows] = await conn.execute(
      `SELECT * FROM users WHERE username = ? LIMIT 1`,
      [username]
    );
    const existing = rows[0] || pending.find(p => p.username === username) || null;

    if (existing) {
      const nameMatches =
        existing.first_name === first_name && existing.last_name === last_name;

      if (!nameMatches) {
        const cosmeticOnly =
          normalizeName(existing.first_name) === normalizeName(first_name) &&
          normalizeName(existing.last_name) === normalizeName(last_name);

        return {
          existing,
          matchType: 'username',
          nameOverwrite: {
            from: { first_name: existing.first_name, last_name: existing.last_name },
            to: { first_name, last_name },
            cosmeticOnly,
          },
        };
      }

      return { existing, matchType: 'username', nameOverwrite: null };
    }
    // Username given but not found in DB or pending inserts -> proceed
    // to insert. We do NOT fall back to name matching here, because
    // this person may intentionally be getting a second, role-specific
    // account.
    return { existing: null, matchType: null, nameOverwrite: null };
  }

  // No username on the incoming row -> try name match, but only
  // accept a match that has the SAME role, to avoid merging an
  // attending record into a trainee record (or vice versa).
  if (first_name && last_name) {
    const [dbRows] = await conn.execute(
      `SELECT * FROM users WHERE first_name = ? AND last_name = ?`,
      [first_name, last_name]
    );
    const pendingRows = pending.filter(
      p => p.first_name === first_name && p.last_name === last_name
    );
    const rows = [...dbRows, ...pendingRows];

    if (rows.length) {
      const sameRole = rows.find(r => r.role === role);
      if (sameRole) {
        return { existing: sameRole, matchType: 'name_role', nameOverwrite: null };
      }

      // Found this person under a different role only -> the sheet
      // needs a username to disambiguate. Fail loudly rather than
      // guess or skip.
      throw new AmbiguousCrossRoleError(
        `${first_name} ${last_name} already exists as role "${rows[0].role}" ` +
        `(username "${rows[0].username}"). This row (role "${role}") has no ` +
        `username, so a new account can't be created without ambiguity. ` +
        `Add a username for this "${role}" row in the sheet and rerun.`
      );
    }
  }

  return { existing: null, matchType: null, nameOverwrite: null };
}

// ─────────────────────────────────────────────
// UPSERT LOGIC
// ─────────────────────────────────────────────

function buildUpdateFields(existing, incoming, allowNameOverwrite) {
  const updates = [];
  const values = [];
  const diffs = []; // { field, from, to } for dry-run/log detail

  for (const key of Object.keys(incoming)) {
    if (incoming[key] == null) continue;
    if (NEVER_UPDATE_FIELDS.has(key)) continue;

    // Never overwrite first/last name UNLESS this call is explicitly
    // resolving a username collision in the sheet's favor.
    if ((key === 'first_name' || key === 'last_name') && !allowNameOverwrite) continue;

    if (existing[key] !== incoming[key]) {
      updates.push(`${key} = ?`);
      values.push(incoming[key]);
      diffs.push({ field: key, from: existing[key], to: incoming[key] });
    }
  }

  return { updates, values, diffs };
}

function label(row) {
  return row.username || `${row.first_name} ${row.last_name}`;
}

async function upsertUser(conn, row, dryRun, pending) {
  // Note: resolveUser can throw AmbiguousCrossRoleError — intentionally
  // not caught here, so it propagates and halts the run (see main()).
  const { existing, nameOverwrite } = await resolveUser(conn, row, pending);

  // ─── INSERT ─────────────────────────────────────────────
  // Password IS set here from the sheet (dummy "123" or a real one) —
  // this is the one place password ever gets written.
  if (!existing) {
    if (dryRun) {
      console.log(
        `[DRY-INSERT] ${label(row)} (${row.role}) — pgy: ${row.pgy ?? '—'}, password: "${row.password ?? '—'}"`
      );
      // Simulate the row that --write would have just committed, so
      // later rows in this same dry run resolve against it exactly
      // like they would against a real committed row.
      pending.push({
        user_id: `pending:${pending.length}`,
        first_name: row.first_name,
        last_name: row.last_name,
        username: row.username,
        role: row.role,
        pgy: row.pgy || null,
      });
      return 'insert';
    }

    await conn.execute(
      `INSERT INTO users (first_name, last_name, username, password, role, pgy)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [row.first_name, row.last_name, row.username, row.password, row.role, row.pgy || null]
    );

    console.log(`[INSERT] ${label(row)} (${row.role})`);
    return 'insert';
  }

  // ─── UPDATE LOGIC ───────────────────────────────────────
  // Password is never included here — see NEVER_UPDATE_FIELDS.
  const { updates, values, diffs } = buildUpdateFields(existing, row, !!nameOverwrite);

  if (updates.length === 0) {
    console.log(`[SKIP] ${label(row)} (${row.role}) — no changes`);
    return 'skip';
  }

  const diffStr = diffs.map(d => `${d.field}: "${d.from ?? '—'}" -> "${d.to}"`).join(', ');

  // In dry-run, if the matched record is itself a simulated pending
  // insert from earlier in this run, apply the diff to it in-memory
  // so a THIRD related row later in the sheet also resolves correctly
  // — mirroring how --write would see the already-committed update.
  if (dryRun) {
    for (const d of diffs) existing[d.field] = d.to;
  }

  if (nameOverwrite) {
    // Cosmetic (case/whitespace only) -> treat as a routine update.
    // Substantive difference -> flag distinctly for a human to check.
    const routine = nameOverwrite.cosmeticOnly;
    const tag = routine
      ? (dryRun ? '[DRY-UPDATE]' : '[UPDATE]')
      : (dryRun ? '[DRY-CONFLICT-RESOLVED]' : '[CONFLICT-RESOLVED]');
    const note = routine
      ? ''
      : ` — name on file was substantively different ("${nameOverwrite.from.first_name} ${nameOverwrite.from.last_name}"); sheet's version was used`;
    console.log(`${tag} ${label(row)} (${row.role}) — ${diffStr}${note}`);
    if (dryRun) return 'update';

    await conn.execute(
      `UPDATE users SET ${updates.join(', ')} WHERE user_id = ?`,
      [...values, existing.user_id]
    );
    return 'update';
  }

  if (dryRun) {
    console.log(`[DRY-UPDATE] ${label(row)} (${row.role}) — ${diffStr}`);
    return 'update';
  }

  await conn.execute(
    `UPDATE users SET ${updates.join(', ')} WHERE user_id = ?`,
    [...values, existing.user_id]
  );

  console.log(`[UPDATE] ${label(row)} (${row.role}) — ${diffStr}`);
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

// Warn about duplicate usernames within the same sheet before we
// touch the DB at all — cheap, obvious mistake to catch up front.
function findInSheetUsernameDupes(rows) {
  const seen = new Map();
  const dupes = [];
  for (const r of rows) {
    if (!r.username) continue;
    if (seen.has(r.username)) {
      dupes.push(r.username);
    }
    seen.set(r.username, true);
  }
  return [...new Set(dupes)];
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

  const attendings = processSheet(attendingsSheet, 'attending');
  const trainees = processSheet(traineeSheet, 'trainee');

  // Catch obvious in-sheet duplicate usernames before hitting the DB.
  for (const [name, rows] of [['import_attendings', attendings], ['import_trainees', trainees]]) {
    const dupes = findInSheetUsernameDupes(rows);
    if (dupes.length) {
      console.log(`[WARN] ${name} has duplicate usernames in the sheet itself: ${dupes.join(', ')}`);
    }
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  // Simulated "would-be inserted" rows, used only in dry-run so later
  // rows in this same run resolve exactly like --write would (see
  // resolveUser's docstring). Always empty in write mode.
  const pending = [];

  const conn = await mysql.createConnection(getDbConfig());

  try {
    console.log(`\nProcessing attendings: ${attendings.length}`);
    for (const row of attendings) {
      const result = await upsertUser(conn, row, argv['dry-run'], pending);
      if (result === 'insert') inserted++;
      else if (result === 'update') updated++;
      else if (result === 'skip') skipped++;
    }

    console.log(`\nProcessing trainees: ${trainees.length}`);
    for (const row of trainees) {
      const result = await upsertUser(conn, row, argv['dry-run'], pending);
      if (result === 'insert') inserted++;
      else if (result === 'update') updated++;
      else if (result === 'skip') skipped++;
    }
  } catch (err) {
    await conn.end();
    if (err instanceof AmbiguousCrossRoleError) {
      console.error(`\n[FATAL - AMBIGUOUS ROW] ${err.message}`);
      console.error('No further rows were processed. Fix the sheet and rerun.\n');
    }
    throw err;
  }

  console.log('\n──────── SUMMARY ────────');
  console.log(`Inserted : ${inserted}`);
  console.log(`Updated  : ${updated}`);
  console.log(`Skipped  : ${skipped}`);
  console.log('─────────────────────────\n');

  await conn.end();

  console.log('Done.');
}

if (require.main === module) {
  main().catch(err => {
    if (!(err instanceof AmbiguousCrossRoleError)) {
      console.error('[FATAL]', err.message);
    }
    process.exit(1);
  });
}