#!/usr/bin/env node
/**
 * scripts/import_masterusers.js
 *
 * Adds and updates rows in the `users` table from an Excel sheet.
 *
 * Expected headers (case-insensitive):
 *   first_name, last_name, username, password, role, pgy,
 *   preferred_name, pgy_note, email
 *
 * Usage:
 *   node scripts/import_masterusers.js users.xlsx --dry-run
 *   node scripts/import_masterusers.js users.xlsx --write
 *   Options:
 *     --sheet <name>   sheet to read (default: first sheet)
 *     --keep-names     never change first_name/last_name on existing users
 *     --strict         with --write: if ANY row has a problem, save nothing
 *     --skip-label <x> extra placeholder label to ignore (repeatable).
 *                      "Fellows" and "Attendings" are always ignored.
 *
 * Attendings: the pgy and pgy_note cells on attending rows are ignored (no
 * validation, no warnings, never written). They stay NULL on new attendings
 * and existing attending values are left untouched.
 *
 * Placeholder rows: a row whose first_name, last_name or username cell is just
 * a label like "Fellows" or "Attendings" (case-insensitive, optional trailing
 * colon) is an organizational divider, not a person. It is ignored entirely:
 * not validated, not imported, not counted as a problem. The role column is
 * never checked for this, since "attending" is a legitimate role value.
 *
 * Safety guarantees
 *   - NEVER deletes anything. The script contains no DELETE statements.
 *   - NEVER changes `role`. A person with several roles has several rows,
 *     one per role, and each row is matched only against rows of the SAME role.
 *   - NEVER changes an existing user's password. Passwords are only used when
 *     a brand-new user is inserted (hashed with bcrypt; a blank password gets
 *     an unusable random hash, so the account is SSO-only).
 *   - NEVER blanks out stored data. An empty cell in the sheet means
 *     "no information", not "clear this field". Only non-empty values that
 *     differ from what is stored are written.
 *   - Dry run and write run the exact same code path inside a database
 *     transaction. Dry run ROLLS BACK at the end, so its output is exactly
 *     what --write would do. (Auto-increment ids are consumed by a dry run;
 *     that is harmless.)
 *
 * How a sheet row finds its existing user (same role only):
 *   1. username + role    (ux_username_role)
 *   2. email + role       (ux_email_role)       - finds people whose username changed
 *   3. first + last + role (ux_name)            - finds people whose username/email changed
 *   - If those keys point at DIFFERENT existing users, the row is reported as a
 *     CONFLICT and skipped. The script never guesses between two people.
 *   - If nothing matches, a new user is inserted (a username is required).
 *
 * Required env vars: AWS_RDS_HOST, AWS_RDS_USER, AWS_RDS_PWD, AWS_RDS_DB
 *                    AWS_RDS_PORT (optional)
 */

'use strict';

require('dotenv').config();

const crypto = require('crypto');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const xlsx = require('xlsx');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const ROLES = ['attending', 'trainee', 'admin'];

// Organizational divider rows in the sheet (lowercase). Extend with --skip-label.
const DEFAULT_SKIP_LABELS = ['fellows', 'attendings'];

// Columns that may be updated on an existing user (password and role never are).
const UPDATABLE = ['username', 'first_name', 'last_name', 'preferred_name', 'pgy', 'pgy_note', 'email'];

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
// SHEET READING / CLEANING
// ─────────────────────────────────────────────

const HEADER_ALIASES = {
  firstname: 'first_name',
  lastname: 'last_name',
  preferredname: 'preferred_name',
  pgynote: 'pgy_note',
};

function canonHeader(h) {
  const k = String(h ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return HEADER_ALIASES[k.replace(/_/g, '')] || k;
}

const str = v => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};
const nameStr = v => {
  const s = str(v);
  return s ? s.replace(/\s+/g, ' ') : null;
};
// Passwords are not trimmed (spaces could be intentional); blank -> null.
const pwStr = v => (v == null || String(v).trim() === '' ? null : String(v));

const lc = s => (s == null ? '' : String(s).toLowerCase());
const normName = s => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();

// "Fellows", " attendings: " -> "fellows", "attendings"
const labelKey = v => lc(str(v)).replace(/[\s:]+$/g, '').replace(/^\s+/, '');

function readRows(filePath, sheetName, skipLabels) {
  const wb = xlsx.readFile(filePath);
  const name = sheetName || wb.SheetNames[0];
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`Sheet "${name}" not found. Sheets in file: ${wb.SheetNames.join(', ')}`);

  const headerRow = (xlsx.utils.sheet_to_json(ws, { header: 1, defval: null })[0] || []).map(canonHeader);
  for (const required of ['first_name', 'last_name', 'role']) {
    if (!headerRow.includes(required)) {
      throw new Error(`Sheet "${name}" is missing a "${required}" column. Found: ${headerRow.join(', ')}`);
    }
  }

  // blankrows: true keeps blank spreadsheet rows in the array so rowNum below
  // matches the real Excel row number even when the sheet has gaps.
  const raw = xlsx.utils.sheet_to_json(ws, { defval: null, raw: true, blankrows: true });
  const rows = [];
  const ignored = [];

  raw.forEach((r, i) => {
    const o = {};
    for (const [k, v] of Object.entries(r)) o[canonHeader(k)] = v;

    // Skip completely empty rows
    if (Object.values(o).every(v => str(v) == null)) return;

    // Skip organizational placeholder rows ("Fellows", "Attendings", ...).
    // Only the name/username cells are checked, never the role column.
    const hit = ['first_name', 'last_name', 'username'].find(k => skipLabels.has(labelKey(o[k])));
    if (hit) {
      ignored.push({ rowNum: i + 2, text: str(o[hit]) });
      return;
    }

    const row = {
      rowNum: i + 2, // +1 for header, +1 for 1-based
      first_name: nameStr(o.first_name),
      last_name: nameStr(o.last_name),
      username: str(o.username),
      password: pwStr(o.password),
      role: lc(str(o.role)) || null,
      pgy: null,
      preferred_name: nameStr(o.preferred_name),
      pgy_note: str(o.pgy_note),
      email: str(o.email) ? str(o.email).toLowerCase() : null,
      errors: [],
    };

    if (!row.first_name) row.errors.push('first_name is empty');
    if (!row.last_name) row.errors.push('last_name is empty');
    if (!ROLES.includes(row.role)) row.errors.push(`role must be one of ${ROLES.join('/')} (got "${o.role ?? ''}")`);
    if (row.email && !/^[^@\s]+@[^@\s]+$/.test(row.email)) row.errors.push(`email "${row.email}" doesn't look valid`);

    // Attendings have no PGY: the pgy and pgy_note cells are ignored entirely
    // (not validated, not written), so stray values there never raise warnings.
    if (row.role === 'attending') row.pgy_note = null;
    const pgyRaw = row.role === 'attending' ? null : str(o.pgy);
    if (pgyRaw != null) {
      const n = Number(pgyRaw);
      if (!Number.isInteger(n) || n < 0 || n > 15) row.errors.push(`pgy must be a whole number 0-15 (got "${pgyRaw}")`);
      else row.pgy = n;
    }

    rows.push(row);
  });

  return { rows, sheetName: name, ignored };
}

// Flag rows that repeat a key already used by an earlier row (same role).
function flagSheetDuplicates(rows) {
  const seen = new Map();
  for (const row of rows) {
    if (!ROLES.includes(row.role)) continue;
    const keys = [];
    if (row.username) keys.push(['username', `u|${lc(row.username)}|${row.role}`]);
    if (row.email) keys.push(['email', `e|${row.email}|${row.role}`]);
    if (row.first_name && row.last_name) {
      keys.push(['name', `n|${lc(row.first_name)}|${lc(row.last_name)}|${row.role}`]);
    }
    for (const [what, k] of keys) {
      if (seen.has(k)) {
        row.errors.push(`same ${what} + role as row ${seen.get(k)} in the sheet`);
      } else {
        seen.set(k, row.rowNum);
      }
    }
  }
}

// ─────────────────────────────────────────────
// MATCHING
// ─────────────────────────────────────────────

async function findCandidates(conn, row) {
  const found = new Map(); // user_id -> { user, via: [] }
  const add = (rows, via) => {
    for (const u of rows) {
      const e = found.get(u.user_id) || { user: u, via: [] };
      e.via.push(via);
      found.set(u.user_id, e);
    }
  };

  if (row.username) {
    const [r] = await conn.execute(`SELECT * FROM users WHERE username = ? AND role = ?`, [row.username, row.role]);
    add(r, 'username');
  }
  if (row.email) {
    const [r] = await conn.execute(`SELECT * FROM users WHERE email = ? AND role = ?`, [row.email, row.role]);
    add(r, 'email');
  }
  const [r] = await conn.execute(
    `SELECT * FROM users WHERE first_name = ? AND last_name = ? AND role = ?`,
    [row.first_name, row.last_name, row.role],
  );
  add(r, 'name');

  return [...found.values()];
}

function diffFields(existing, row, opts) {
  const changes = [];
  for (const f of UPDATABLE) {
    const incoming = row[f];
    if (incoming == null) continue; // blank cell = no information
    if (opts.keepNames && (f === 'first_name' || f === 'last_name')) continue;
    const current = existing[f];
    if (String(current ?? '') === String(incoming)) continue;
    changes.push({ field: f, from: current ?? null, to: incoming });
  }
  return changes;
}

const fmtChanges = changes => changes.map(c => `${c.field}: "${c.from ?? '—'}" -> "${c.to}"`).join(', ');
const label = row => `row ${row.rowNum}: ${row.username || `${row.first_name} ${row.last_name}`} (${row.role})`;

// ─────────────────────────────────────────────
// PER-ROW WORK
// ─────────────────────────────────────────────

async function passwordForInsert(row, dryRun) {
  if (dryRun) return '(dry-run)';
  if (!row.password) return bcrypt.hash(crypto.randomUUID(), 10); // unusable: SSO-only
  if (/^\$2[aby]\$/.test(row.password)) return row.password; // already a bcrypt hash
  return bcrypt.hash(row.password, 10);
}

async function processRow(conn, row, opts, ctx) {
  const T = t => (opts.dryRun ? `[DRY-${t}]` : `[${t}]`);
  const candidates = await findCandidates(conn, row);

  // Different existing users matched by different keys -> do not guess.
  if (candidates.length > 1) {
    const desc = candidates
      .map(c => `user_id ${c.user.user_id} "${c.user.username}" (matched by ${c.via.join('+')})`)
      .join('; ');
    ctx.problem(row, `CONFLICT: this row matches more than one existing ${row.role}: ${desc}. Fix the sheet or the database and rerun.`);
    return;
  }

  // ─── INSERT ───────────────────────────────────────────
  if (candidates.length === 0) {
    if (!row.username) {
      ctx.problem(row, `no existing ${row.role} found and the row has no username, so a new user can't be created.`);
      return;
    }
    const pw = await passwordForInsert(row, opts.dryRun);
    await conn.execute(
      `INSERT INTO users (first_name, last_name, username, password, role, pgy, preferred_name, pgy_note, email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.first_name, row.last_name, row.username, pw, row.role, row.pgy, row.preferred_name, row.pgy_note, row.email],
    );
    ctx.stats.inserted++;
    console.log(
      `${T('INSERT')} ${label(row)} — pgy: ${row.pgy ?? '—'}, email: ${row.email ?? '—'}, ` +
      `password: ${row.password ? 'from sheet (hashed)' : 'none (SSO-only)'}`,
    );
    return;
  }

  // ─── UPDATE ───────────────────────────────────────────
  const { user: existing, via } = candidates[0];
  const changes = diffFields(existing, row, opts);

  if (changes.length === 0) {
    ctx.stats.unchanged++;
    console.log(`[SKIP] ${label(row)} — no changes (matched by ${via.join('+')})`);
    return;
  }

  let kind = 'UPDATE';
  let note = '';
  if (changes.some(c => c.field === 'first_name' || c.field === 'last_name')) {
    const before = normName(`${existing.first_name} ${existing.last_name}`);
    const after = normName(`${row.first_name} ${row.last_name}`);
    if (before !== after) {
      kind = 'NAME-CHANGE';
      note = ` — name on file was "${existing.first_name} ${existing.last_name}"; the sheet's version is used`;
    }
  }

  await conn.execute(
    `UPDATE users SET ${changes.map(c => `${c.field} = ?`).join(', ')} WHERE user_id = ?`,
    [...changes.map(c => c.to), existing.user_id],
  );

  const uc = changes.find(c => c.field === 'username');
  if (uc && uc.from) ctx.usernameChanges.push({ from: uc.from, userId: existing.user_id, role: row.role });

  ctx.stats.updated++;
  console.log(`${T(kind)} ${label(row)} (matched by ${via.join('+')}) — ${fmtChanges(changes)}${note}`);
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────

async function main() {
  const argv = yargs(hideBin(process.argv))
    .usage('node scripts/import_masterusers.js <file.xlsx> [--dry-run|--write]')
    .demandCommand(1)
    .option('dry-run', { type: 'boolean', default: false })
    .option('write', { type: 'boolean', default: false })
    .option('sheet', { type: 'string', describe: 'sheet name (default: first sheet)' })
    .option('keep-names', { type: 'boolean', default: false, describe: 'never change first/last name on existing users' })
    .option('strict', { type: 'boolean', default: false, describe: 'with --write: save nothing if any row has a problem' })
    .option('skip-label', { type: 'array', default: [], describe: 'extra placeholder label to ignore (repeatable); Fellows/Attendings are always ignored' })
    .check(a => {
      if (!a['dry-run'] && !a.write) throw new Error('Must pass --dry-run or --write');
      if (a['dry-run'] && a.write) throw new Error('--dry-run and --write cannot be used together');
      return true;
    })
    .argv;

  const opts = { dryRun: argv['dry-run'], keepNames: argv['keep-names'], strict: argv.strict };

  const skipLabels = new Set([...DEFAULT_SKIP_LABELS, ...argv['skip-label'].map(labelKey)].filter(Boolean));

  const { rows, sheetName, ignored } = readRows(argv._[0], argv.sheet, skipLabels);
  flagSheetDuplicates(rows);
  console.log(`Read ${rows.length} rows from sheet "${sheetName}" (${opts.dryRun ? 'DRY RUN' : 'WRITE'})`);
  for (const ig of ignored) console.log(`[IGNORED] row ${ig.rowNum}: placeholder "${ig.text}"`);
  console.log('');

  const stats = { inserted: 0, updated: 0, unchanged: 0 };
  const problems = [];
  const usernameChanges = [];
  const ctx = {
    stats,
    usernameChanges,
    problem(row, msg) {
      problems.push({ row, msg });
      console.log(`[PROBLEM] ${label(row)} — ${msg}`);
    },
  };

  const conn = await mysql.createConnection(getDbConfig());
  await conn.beginTransaction();

  try {
    for (const row of rows) {
      if (row.errors.length) {
        ctx.problem(row, row.errors.join('; '));
        continue;
      }
      try {
        await processRow(conn, row, opts, ctx);
      } catch (err) {
        if (err && err.code === 'ER_DUP_ENTRY') {
          // A failed statement is rolled back by MySQL on its own; the transaction stays usable.
          ctx.problem(row, `CONFLICT with an existing row: ${err.sqlMessage}`);
        } else {
          throw err;
        }
      }
    }

    // Informational: profiles of the same person that still carry a username we just replaced.
    const seenNotes = new Set();
    for (const ch of usernameChanges) {
      const [others] = await conn.execute(
        `SELECT user_id, role FROM users WHERE username = ? AND user_id <> ?`,
        [ch.from, ch.userId],
      );
      if (others.length && !seenNotes.has(ch.from)) {
        seenNotes.add(ch.from);
        console.log(
          `[NOTE] username "${ch.from}" was replaced on a ${ch.role} profile, but ` +
          `${others.map(o => o.role).join(', ')} profile(s) still use it. ` +
          `Add those rows to the sheet if they should change too.`,
        );
      }
    }

    let outcome;
    if (opts.dryRun) {
      await conn.rollback();
      outcome = 'Dry run: nothing was saved.';
    } else if (opts.strict && problems.length) {
      await conn.rollback();
      outcome = 'Strict mode: problems were found, so NOTHING was saved.';
    } else {
      await conn.commit();
      outcome = 'Changes saved.';
    }

    console.log('\n──────── SUMMARY ────────');
    console.log(`Would insert / inserted : ${stats.inserted}`);
    console.log(`Would update / updated  : ${stats.updated}`);
    console.log(`Unchanged               : ${stats.unchanged}`);
    console.log(`Ignored placeholders    : ${ignored.length}`);
    console.log(`Problems (skipped)      : ${problems.length}`);
    console.log('─────────────────────────');
    console.log(outcome);

    if (problems.length) {
      console.log('\nRows needing attention:');
      for (const p of problems) console.log(`  - ${label(p.row)}: ${p.msg}`);
    }

    process.exitCode = problems.length ? 1 : 0;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('[FATAL]', err.message);
    process.exit(1);
  });
}