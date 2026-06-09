#!/usr/bin/env node
/**
 * scripts/import_excel.js
 *
 * Imports an Excel file into the `reports` table.
 * Does nothing else — no personnel parsing, no EPA extraction.
 * Run extract_personnel.js separately after this.
 *
 * Usage:
 *   node scripts/import_excel.js /path/to/file.xlsx [--force]
 *
 *   --force   Re-import and overwrite existing rows (default: skip duplicates)
 *
 * Required env vars (in .env or environment):
 *   AWS_RDS_HOST, AWS_RDS_USER, AWS_RDS_PWD, AWS_RDS_DB
 *   AWS_RDS_PORT  (optional, defaults to 3306)
 */

'use strict';

require('dotenv').config();

const xlsx  = require('xlsx');
const mysql = require('mysql2/promise');
const path  = require('path');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

// ─── DB config ────────────────────────────────────────────────────────────────

function getRdsConfig() {
  const host     = process.env.AWS_RDS_HOST;
  const user     = process.env.AWS_RDS_USER;
  const password = process.env.AWS_RDS_PWD;
  const database = process.env.AWS_RDS_DB;
  const port     = Number(process.env.AWS_RDS_PORT || 3306);
  if (!host || !user || !password || !database) {
    throw new Error('Missing env vars: AWS_RDS_HOST, AWS_RDS_USER, AWS_RDS_PWD, AWS_RDS_DB');
  }
  return { host, user, password, database, port };
}

// ─── Excel helpers ────────────────────────────────────────────────────────────

function normalize(s) {
  return s ? String(s).trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

function pad2(n) { return String(n).padStart(2, '0'); }

function toMySQLDate(d) {
  if (!(d instanceof Date) || isNaN(d)) return null;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
         `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function parseExcelDate(v) {
  if (!v) return null;
  if (v instanceof Date) return toMySQLDate(v);
  const d = new Date(v);
  return isNaN(d) ? null : toMySQLDate(d);
}

// Maps normalised Excel header strings to reports column names.
// Intentionally omits dictator/signer/epa — those are derived from
// ContentText by extract_personnel.js, not taken from the spreadsheet.
const HEADER_ALIASES = {
  reportid:        'ReportID',
  result_text:     'ContentText',
  exam_final_date: 'CreateDate',
  last_sign_date:  'CreateDate',
  accession_num:   'Accession',
  proc_code_list:  'ProcedureCodeList',
  proc_name:       'ProcedureDescList',
};

// The columns we will actually insert, in order.
const TARGET_COLUMNS = [
  'ReportID',
  'ContentText',
  'CreateDate',
  'Accession',
  'ReasonForStudy',
  'ProcedureCodeList',
  'ProcedureDescList',
];

function mapHeaders(headers) {
  return headers.map(h => {
    const key = normalize(h).replace(/[^a-z0-9_]/g, '');
    return HEADER_ALIASES[key] || null;
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option('force', {
      type:        'boolean',
      default:     false,
      description: 'Overwrite existing rows on duplicate ReportID',
    })
    .argv;

  const filePath = argv._[0];
  if (!filePath) {
    console.error('Usage: node scripts/import_excel.js /path/to/file.xlsx [--force]');
    process.exit(1);
  }

  const rdsConfig = getRdsConfig();
  console.log(`\nDB: ${rdsConfig.database} @ ${rdsConfig.host}:${rdsConfig.port}`);

  // ── Read workbook ──────────────────────────────────────────────────────────
  console.log(`Reading: ${path.resolve(filePath)}`);
  const wb      = xlsx.readFile(path.resolve(filePath), { cellDates: true });
  const sheet   = wb.SheetNames[0];
  const rowsRaw = xlsx.utils.sheet_to_json(wb.Sheets[sheet], { defval: null });

  if (!rowsRaw.length) {
    console.error('[ERROR] No rows found in workbook.');
    process.exit(1);
  }

  const headers   = Object.keys(rowsRaw[0]);
  const headerMap = mapHeaders(headers);

  console.log('\nHeader mapping:');
  headers.forEach((h, i) =>
    console.log(`  "${h}"  →  ${headerMap[i] || '<ignored>'}`)
  );

  // Verify that the essential columns were found
  const mapped = headerMap.filter(Boolean);
  if (!mapped.includes('ReportID')) {
    console.error('\n[ERROR] Could not find a ReportID column. Check HEADER_ALIASES.');
    process.exit(1);
  }
  if (!mapped.includes('ContentText')) {
    console.warn('\n[WARN] Could not find a ContentText column — reports will have no text to parse later.');
  }

  // Build the value arrays in TARGET_COLUMNS order
  const rows = rowsRaw.map(r => {
    const row = TARGET_COLUMNS.map(() => null);
    headers.forEach((h, i) => {
      const col = headerMap[i];
      if (!col) return;
      const idx = TARGET_COLUMNS.indexOf(col);
      if (idx === -1) return;
      let val = r[h];
      if (col === 'CreateDate') val = parseExcelDate(val);
      row[idx] = val ?? null;
    });
    return row;
  });

  // ── Connect and insert ─────────────────────────────────────────────────────
  console.log(`\nConnecting…`);
  const conn = await mysql.createConnection(rdsConfig);

  const colsSQL        = TARGET_COLUMNS.map(c => `\`${c}\``).join(', ');
  const rowPlaceholder = '(' + TARGET_COLUMNS.map(() => '?').join(', ') + ')';

  // With --force we overwrite every column on duplicate key.
  // Without it we do nothing on duplicate (INSERT IGNORE equivalent via empty UPDATE).
  const updateClause = argv.force
    ? TARGET_COLUMNS
        .filter(c => c !== 'ReportID')
        .map(c => `\`${c}\` = VALUES(\`${c}\`)`)
        .join(', ')
    : '`ReportID` = `ReportID`';   // no-op update — row is left unchanged

  const BATCH  = 200;
  let inserted = 0, updated = 0, failed = 0;
  const failedIds = [];

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch        = rows.slice(i, i + BATCH);
    const placeholders = batch.map(() => rowPlaceholder).join(', ');
    const values       = batch.flat();

    try {
      const [result] = await conn.execute(
        `INSERT INTO reports (${colsSQL}) VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE ${updateClause}`,
        values
      );
      inserted += result.affectedRows - result.changedRows;
      updated  += result.changedRows;
    } catch (batchErr) {
      // Retry row-by-row to isolate bad records
      for (const singleRow of batch) {
        const reportId = singleRow[TARGET_COLUMNS.indexOf('ReportID')];
        try {
          const [result] = await conn.execute(
            `INSERT INTO reports (${colsSQL}) VALUES ${rowPlaceholder}
             ON DUPLICATE KEY UPDATE ${updateClause}`,
            singleRow
          );
          if (result.changedRows) updated++;
          else inserted++;
        } catch (rowErr) {
          failed++;
          failedIds.push(reportId);
          console.error(`\n[ERROR] ReportID ${reportId ?? '(null)'}: ${rowErr.message}`);
        }
      }
    }

    process.stdout.write(
      `  ${i + batch.length}/${rows.length} — ` +
      `new: ${inserted}  updated: ${updated}  failed: ${failed}\r`
    );
  }

  await conn.end();

  console.log(`\n\n[DONE]`);
  console.log(`  Rows in Excel        : ${rows.length}`);
  console.log(`  Inserted (new)       : ${inserted}`);
  console.log(`  Updated (--force)    : ${updated}`);
  console.log(`  Skipped (duplicate)  : ${rows.length - inserted - updated - failed}`);
  console.log(`  Failed               : ${failed}`);
  if (failedIds.length) {
    console.log(`\n  Failed ReportIDs:`);
    for (const id of failedIds) console.log(`    ${id}`);
  }
  console.log(`\nNext step: node scripts/extract_personnel.js --dry-run`);
}

main().catch(err => { console.error('\n[FATAL]', err.message); process.exit(1); });