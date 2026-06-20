/**
 * import_proc_types.js
 *
 * Imports procedure metadata from an EPA_Categories-style file and/or
 * alias mappings from a Procedure_Name_Alias-style file into proc_types /
 * proc_aliases / proc_type_aliases.
 *
 * --epa-file and --alias-file are each independently optional -- pass
 * whichever one(s) you have new data for. At least one is required.
 * Note: the alias phase looks up proc_types rows by proc_desc, so if you
 * run --alias-file alone, those procedures must already exist in the
 * database (e.g. from a prior --epa-file run).
 *
 * Run 01_schema_migration.sql against the database BEFORE running this.
 *
 * Phases (each only runs if its file was provided):
 *   1. Read whichever Excel file(s) were passed.
 *   2. [--epa-file only] Pull distinct (proc_desc, proc_code) pairs from
 *      `reports` and flag any proc_desc <-> proc_code inconsistency
 *      (1:many in either direction) -- reported, not silently resolved.
 *   3. [--epa-file only] Upsert proc_types rows from the EPA_Categories
 *      sheet, matching each Excel "Procedure" name against
 *      reports.proc_desc (case/whitespace normalized exact match).
 *      Unmatched rows get a placeholder proc_code.
 *   4. [--alias-file only] Upsert proc_aliases + proc_type_aliases
 *      junction rows from the Procedure_Name_Alias sheet, looking up each
 *      referenced procedure's id from the existing proc_types table.
 *   5. Print a summary report (matched / placeholder / skipped counts,
 *      ambiguous mappings, unmatched aliases).
 *
 * Usage:
 *   node import_proc_types.js [--epa-file <path>] [--alias-file <path>] [options]
 *
 * At least one of:
 *   --epa-file <path>     Path to the EPA_Categories-style .xlsx file
 *   --alias-file <path>   Path to the Procedure_Name_Alias-style .xlsx file
 *
 * Optional:
 *   --epa-sheet <name>    Sheet name in the EPA file (default: "Version 1")
 *   --alias-sheet <name>  Sheet name in the alias file (default: "Sheet1")
 *   --dry-run             Read/match and print the report WITHOUT writing
 *                         to the database. Recommended on first run.
 *
 * Examples:
 *   # Process both files together
 *   node import_proc_types.js \
 *     --epa-file ./EPA_Categories.xlsx \
 *     --alias-file ./Procedure_Name_Alias.xlsx \
 *     --dry-run
 *
 *   # New procedures only, no alias changes
 *   node import_proc_types.js --epa-file "/data/imports/EPA_Categories_2026.xlsx"
 *
 *   # New aliases only, procedures already in the database
 *   node import_proc_types.js --alias-file "/data/imports/Procedure_Name_Alias_2026.xlsx"
 */
'use strict';

require('dotenv').config();
const mysql = require('mysql2/promise');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// --------------------------------------------------------------------------
// CLI args
// --------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--epa-file':
        args.epaFile = argv[++i];
        break;
      case '--alias-file':
        args.aliasFile = argv[++i];
        break;
      case '--epa-sheet':
        args.epaSheet = argv[++i];
        break;
      case '--alias-sheet':
        args.aliasSheet = argv[++i];
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        console.warn(`Unrecognized argument: ${a}`);
    }
  }
  return args;
}

function printUsageAndExit(code) {
  console.log(`
Usage:
  node import_proc_types.js [--epa-file <path>] [--alias-file <path>] [options]

At least one of:
  --epa-file <path>     Path to the EPA_Categories-style .xlsx file
  --alias-file <path>   Path to the Procedure_Name_Alias-style .xlsx file

Optional:
  --epa-sheet <name>    Sheet name in the EPA file (default: "Version 1")
  --alias-sheet <name>  Sheet name in the alias file (default: "Sheet1")
  --dry-run             Read/match and print the report WITHOUT writing
                         to the database

Note: --alias-file alone requires the referenced procedures to already
exist in proc_types (e.g. from a prior --epa-file run).
`);
  process.exit(code);
}

const cliArgs = parseArgs(process.argv.slice(2));

if (cliArgs.help) {
  printUsageAndExit(0);
}

if (!cliArgs.epaFile && !cliArgs.aliasFile) {
  console.error('Error: at least one of --epa-file or --alias-file is required.\n');
  printUsageAndExit(1);
}

const RUN_EPA = Boolean(cliArgs.epaFile);
const RUN_ALIAS = Boolean(cliArgs.aliasFile);

const EPA_CATEGORIES_FILE = RUN_EPA ? path.resolve(cliArgs.epaFile) : null;
const EPA_CATEGORIES_SHEET = cliArgs.epaSheet || 'Version 1';

const ALIAS_FILE = RUN_ALIAS ? path.resolve(cliArgs.aliasFile) : null;
const ALIAS_SHEET = cliArgs.aliasSheet || 'Sheet1';

for (const [label, filePath] of [
  ['--epa-file', EPA_CATEGORIES_FILE],
  ['--alias-file', ALIAS_FILE],
]) {
  if (filePath && !fs.existsSync(filePath)) {
    console.error(`Error: ${label} not found at: ${filePath}`);
    process.exit(1);
  }
}

const DRY_RUN = cliArgs.dryRun;

// --------------------------------------------------------------------------
// Config -- adjust to match your environment / actual `reports` columns
// --------------------------------------------------------------------------

// ─── DB config ────────────────────────────────────────────────────────────────

function getRdsConfig() {
  const host=process.env.AWS_RDS_HOST, user=process.env.AWS_RDS_USER,
        password=process.env.AWS_RDS_PWD, database=process.env.AWS_RDS_DB,
        port=Number(process.env.AWS_RDS_PORT||3306);
  if (!host||!user||!password||!database)
    throw new Error('Missing env vars: AWS_RDS_HOST, AWS_RDS_USER, AWS_RDS_PWD, AWS_RDS_DB');
  return {host,user,password,database,port,multipleStatements:false};
}

// reports table column names (see `describe reports` -- ProcedureCodeList /
// ProcedureDescList are named "List" but hold a single value per report).
const REPORTS_TABLE = 'reports';
const REPORTS_DESC_COL = 'ProcedureDescList';
const REPORTS_CODE_COL = 'ProcedureCodeList';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Normalize for matching: trim, collapse internal whitespace, uppercase. */
function norm(str) {
  if (str === null || str === undefined) return '';
  return String(str).trim().replace(/\s+/g, ' ').toUpperCase();
}

/** Trim only (preserve original casing) -- for values we actually store. */
function clean(str) {
  if (str === null || str === undefined) return null;
  const s = String(str).trim().replace(/\s+/g, ' ');
  return s.length ? s : null;
}

function readSheet(file, sheetName) {
  const wb = XLSX.readFile(file);
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    throw new Error(`Sheet "${sheetName}" not found in ${file}`);
  }
  return XLSX.utils.sheet_to_json(ws, { defval: null });
}

// --------------------------------------------------------------------------
// Phase 1: Read Excel files
// --------------------------------------------------------------------------
function loadEpaCategories() {
  const rows = readSheet(EPA_CATEGORIES_FILE, EPA_CATEGORIES_SHEET);
  return rows
    .filter((r) => r.Procedure)
    .map((r) => ({
      procedure: clean(r.Procedure),
      category: clean(r.Category),
      coreCategory: clean(r['Core Category']),
      complexity:
        r.Complexity === null || r.Complexity === undefined || r.Complexity === ''
          ? null
          : Number(r.Complexity),
    }));
}

function loadAliases() {
  const rows = readSheet(ALIAS_FILE, ALIAS_SHEET);
  return rows
    .filter((r) => r.Alias && r.Procedure)
    .map((r) => ({
      alias: clean(r.Alias),
      procedure: clean(r.Procedure),
    }));
}

// --------------------------------------------------------------------------
// Phase 2: Pull distinct proc_desc / proc_code pairs from reports,
//          detect inconsistent mappings
// --------------------------------------------------------------------------
async function loadReportsProcInfo(conn) {
  const [rows] = await conn.query(
    `SELECT DISTINCT TRIM(${REPORTS_DESC_COL}) AS proc_desc,
            TRIM(${REPORTS_CODE_COL}) AS proc_code
     FROM ${REPORTS_TABLE}
     WHERE ${REPORTS_DESC_COL} IS NOT NULL
       AND ${REPORTS_DESC_COL} <> ''`
  );

  // desc -> set of codes, code -> set of descs (post-normalization)
  const descToCodes = new Map();
  const codeToDescs = new Map();
  // normalized desc -> { proc_desc (original casing), proc_code (first seen) }
  const byNormDesc = new Map();

  for (const row of rows) {
    const desc = row.proc_desc;
    const code = row.proc_code;
    if (!desc) continue;

    const nDesc = norm(desc);

    if (!descToCodes.has(nDesc)) descToCodes.set(nDesc, new Set());
    if (code) descToCodes.get(nDesc).add(code);

    if (code) {
      if (!codeToDescs.has(code)) codeToDescs.set(code, new Set());
      codeToDescs.get(code).add(nDesc);
    }

    if (!byNormDesc.has(nDesc)) {
      byNormDesc.set(nDesc, { proc_desc: desc, proc_code: code || null });
    }
  }

  const ambiguousDesc = [...descToCodes.entries()].filter(([, codes]) => codes.size > 1);
  const ambiguousCode = [...codeToDescs.entries()].filter(([, descs]) => descs.size > 1);

  return { byNormDesc, ambiguousDesc, ambiguousCode };
}

// --------------------------------------------------------------------------
// Phase 3: Upsert proc_types
// --------------------------------------------------------------------------
async function upsertProcTypes(conn, epaRows, reportsInfo) {
  const results = {
    matched: [],
    placeholder: [],
  };

  let placeholderSeq = 1;

  for (const row of epaRows) {
    const nProc = norm(row.procedure);
    const reportMatch = reportsInfo.byNormDesc.get(nProc);

    let procCode;
    let procDesc = row.procedure; // store Excel's casing as canonical desc

    if (reportMatch && reportMatch.proc_code) {
      procCode = reportMatch.proc_code;
      results.matched.push(row.procedure);
    } else {
      procCode = `PENDING-${placeholderSeq++}`;
      results.placeholder.push(row.procedure);
    }

    if (!DRY_RUN) {
      await conn.query(
        `INSERT INTO proc_types
           (proc_code, proc_desc, proc_cat, core_category, complexity)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           proc_code = VALUES(proc_code),
           proc_cat = VALUES(proc_cat),
           core_category = VALUES(core_category),
           complexity = VALUES(complexity)`,
        [procCode, procDesc, row.category, row.coreCategory, row.complexity]
      );
    }
  }

  return results;
}

// --------------------------------------------------------------------------
// Phase 4: Upsert proc_aliases + proc_type_aliases
// --------------------------------------------------------------------------
async function upsertAliases(conn, aliasRows) {
  const results = {
    linked: [],
    unmatchedProcedure: [],
  };

  // Cache proc_desc -> proc_types.id lookups within this run
  const procIdCache = new Map();

  async function getProcTypeId(procDescOriginal) {
    const nProc = norm(procDescOriginal);
    if (procIdCache.has(nProc)) return procIdCache.get(nProc);

    const [rows] = await conn.query(
      `SELECT id FROM proc_types WHERE UPPER(TRIM(proc_desc)) = ?`,
      [nProc]
    );
    const id = rows.length ? rows[0].id : null;
    procIdCache.set(nProc, id);
    return id;
  }

  for (const row of aliasRows) {
    const procTypeId = DRY_RUN ? 'DRY_RUN' : await getProcTypeId(row.procedure);

    if (procTypeId === null) {
      results.unmatchedProcedure.push(row);
      continue;
    }

    if (DRY_RUN) {
      results.linked.push(row);
      continue;
    }

    // Upsert the alias dictionary entry
    await conn.query(
      `INSERT INTO proc_aliases (alias) VALUES (?)
       ON DUPLICATE KEY UPDATE alias = VALUES(alias)`,
      [row.alias]
    );
    const [aliasRowsRes] = await conn.query(
      `SELECT id FROM proc_aliases WHERE alias = ?`,
      [row.alias]
    );
    const aliasId = aliasRowsRes[0].id;

    // Link alias <-> proc_type (idempotent)
    await conn.query(
      `INSERT IGNORE INTO proc_type_aliases (proc_type_id, alias_id) VALUES (?, ?)`,
      [procTypeId, aliasId]
    );

    results.linked.push(row);
  }

  return results;
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------
async function main() {
  console.log(DRY_RUN ? '*** DRY RUN -- no database writes will occur ***\n' : 'Running import...\n');

  const epaRows = RUN_EPA ? loadEpaCategories() : [];
  const aliasRows = RUN_ALIAS ? loadAliases() : [];

  if (RUN_EPA) {
    console.log(`Loaded ${epaRows.length} procedures from ${EPA_CATEGORIES_FILE} (sheet: "${EPA_CATEGORIES_SHEET}")`);
  } else {
    console.log('Skipping proc_types import (no --epa-file given).');
  }
  if (RUN_ALIAS) {
    console.log(`Loaded ${aliasRows.length} alias rows from ${ALIAS_FILE} (sheet: "${ALIAS_SHEET}")`);
  } else {
    console.log('Skipping alias import (no --alias-file given).');
  }
  console.log('');

  const conn = await mysql.createConnection(getRdsConfig());

  try {
    // The reports proc_desc/proc_code scan is only needed for the
    // proc_types phase -- skip it entirely on alias-only runs.
    const reportsInfo = RUN_EPA
      ? await loadReportsProcInfo(conn)
      : { byNormDesc: new Map(), ambiguousDesc: [], ambiguousCode: [] };

    if (reportsInfo.ambiguousDesc.length) {
      console.log(`!! ${reportsInfo.ambiguousDesc.length} proc_desc value(s) map to MULTIPLE proc_codes in reports:`);
      for (const [desc, codes] of reportsInfo.ambiguousDesc) {
        console.log(`   "${desc}" -> [${[...codes].join(', ')}]`);
      }
      console.log('   (First/any code is not auto-selected -- review these manually.)\n');
    }

    if (reportsInfo.ambiguousCode.length) {
      console.log(`!! ${reportsInfo.ambiguousCode.length} proc_code value(s) map to MULTIPLE proc_desc in reports:`);
      for (const [code, descs] of reportsInfo.ambiguousCode) {
        console.log(`   "${code}" -> [${[...descs].join(' | ')}]`);
      }
      console.log('');
    }

    if (!DRY_RUN) await conn.beginTransaction();

    const procTypesResult = RUN_EPA
      ? await upsertProcTypes(conn, epaRows, reportsInfo)
      : { matched: [], placeholder: [] };
    const aliasResult = RUN_ALIAS
      ? await upsertAliases(conn, aliasRows)
      : { linked: [], unmatchedProcedure: [] };

    if (!DRY_RUN) await conn.commit();

    // ---- Summary ----
    if (RUN_EPA) {
      console.log('=== proc_types import summary ===');
      console.log(`  Matched to existing reports.proc_code: ${procTypesResult.matched.length}`);
      console.log(`  Inserted/updated with placeholder code: ${procTypesResult.placeholder.length}`);
      if (procTypesResult.placeholder.length) {
        console.log('  Procedures with NO match in reports (review proc_code manually):');
        for (const p of procTypesResult.placeholder) console.log(`    - ${p}`);
      }
    }

    if (RUN_ALIAS) {
      console.log('\n=== alias import summary ===');
      console.log(`  Linked: ${aliasResult.linked.length}`);
      console.log(`  Unmatched procedure (no proc_types row found): ${aliasResult.unmatchedProcedure.length}`);
      if (aliasResult.unmatchedProcedure.length) {
        for (const r of aliasResult.unmatchedProcedure) {
          console.log(`    - alias "${r.alias}" -> procedure "${r.procedure}" (NOT FOUND)`);
        }
      }
    }

    console.log(DRY_RUN ? '\nDry run complete. Re-run without --dry-run to write changes.' : '\nImport complete.');
  } catch (err) {
    if (!DRY_RUN) {
      try {
        await conn.rollback();
      } catch (_) {}
    }
    console.error('Import failed, rolled back:', err);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exitCode = 1;
});