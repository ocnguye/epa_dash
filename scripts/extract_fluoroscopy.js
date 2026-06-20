#!/usr/bin/env node
/**
 * scripts/extract_fluoroscopy.js
 *
 * Extracts fluoroscopy time, dose, and CT DLP values from reports.ContentText
 * and writes them to the corresponding columns on the reports table.
 *
 * Usage:
 *   node scripts/extract_fluoroscopy.js --dry-run [--limit N] [--report-id ID]
 *   node scripts/extract_fluoroscopy.js --write   [--limit N] [--report-id ID]
 */

'use strict';

require('dotenv').config();

const mysql = require('mysql2/promise');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

function getRdsConfig() {
  const host = process.env.AWS_RDS_HOST, 
        user = process.env.AWS_RDS_USER,
        password = process.env.AWS_RDS_PWD, 
        database = process.env.AWS_RDS_DB,
        port = Number(process.env.AWS_RDS_PORT || 3306);
  if (!host || !user || !password || !database)
    throw new Error('Missing env vars: AWS_RDS_HOST, AWS_RDS_USER, AWS_RDS_PWD, AWS_RDS_DB');
  return { host, user, password, database, port, multipleStatements: false };
}

// ─── Extraction helpers ───────────────────────────────────────────────────────

// Extract a number+unit token from a substring of text starting at a label
function extractRaw(text, label) {
  const idx = text.search(new RegExp(label, 'i'));
  if (idx === -1) return null;
  const slice = text.slice(idx, idx + 50);
  const m = slice.match(/([0-9]+(?:\.[0-9]+)?)\s*([A-Za-zμ%]+)/);
  return m ? m[0].trim() : null;
}

function extractNumber(text, label) {
  const idx = text.search(new RegExp(label, 'i'));
  if (idx === -1) return null;
  const slice = text.slice(idx, idx + 50);
  const m = slice.match(/([0-9]+(?:\.[0-9]+)?)/);
  return m ? parseFloat(m[1]) : null;
}

function extractUnit(raw) {
  if (!raw) return null;
  const m = raw.match(/^[0-9]+(?:\.[0-9]+)?\s*([A-Za-zμ%]+(?:-[A-Za-z]+)?)/);
  return m ? m[1].toLowerCase().trim() : null;
}

// ─── Fluoroscopy time ─────────────────────────────────────────────────────────

function extractFluoroTime(text) {
  if (!/fluoroscopy time/i.test(text)) return { raw: null, unit: null, minutes: null };

  const raw  = extractRaw(text, 'Fluoroscopy time');
  const unit = extractUnit(raw);
  const num  = extractNumber(text, 'Fluoroscopy time');

  let minutes = null;
  if (num !== null && unit) {
    if (['minute','minutes','min','mins'].includes(unit)) minutes = num;
    else if (['second','seconds','sec','secs','s'].includes(unit)) minutes = num / 60;
  }

  return { raw, unit, minutes: minutes !== null ? parseFloat(minutes.toFixed(3)) : null };
}

// ─── Fluoroscopy dose ─────────────────────────────────────────────────────────

function extractFluoroDose(text) {
  if (!/fluoroscopy dose|reference air kerma/i.test(text)) return { raw: null, value: null, unit: null };

  const label = /fluoroscopy dose/i.test(text) ? 'Fluoroscopy dose' : 'Reference air kerma';
  const raw   = extractRaw(text, label);
  const value = extractNumber(text, label);
  const unit  = extractUnit(raw);

  return {
    raw,
    value: value !== null ? parseFloat(value.toFixed(3)) : null,
    unit,
  };
}

// ─── CT DLP dose ──────────────────────────────────────────────────────────────

function extractDlp(text) {
  if (!/\bDLP\b/i.test(text)) return { raw: null, value: null, unit: null };

  const dlpIdx = text.search(/\bDLP\b/i);
  const slice  = text.slice(dlpIdx, dlpIdx + 120);

  // Pattern 1: "DLP dose: 123.45 mGy" or "DLP: 123.45 mGy-cm"
  let m = slice.match(/DLP\s*(?:dose)?\s*[:\s]+([0-9]+(?:\.[0-9]+)?)\s*(mGy(?:-cm)?)/i);

  // Pattern 2: "DLP for this examination was 123.45 mGy-cm"
  if (!m) m = slice.match(/DLP\s+[a-z ]*?\s+([0-9]+(?:\.[0-9]+)?)\s*(mGy(?:-cm)?)/i);

  if (!m) {
    // Fallback: just grab first number after DLP label
    const numM = slice.match(/([0-9]+(?:\.[0-9]+)?)/);
    if (!numM) return { raw: null, value: null, unit: null };
    return {
      raw:   numM[0],
      value: parseFloat(parseFloat(numM[1]).toFixed(4)),
      unit:  'mgy-cm',
    };
  }

  return {
    raw:   m[0].trim(),
    value: parseFloat(parseFloat(m[1]).toFixed(4)),
    unit:  'mgy-cm',
  };
}

// ─── Combined extraction ──────────────────────────────────────────────────────

function extractAll(text) {
  if (!text) return null;

  const hasFluoro = /fluoroscopy time|fluoroscopy dose|reference air kerma/i.test(text);
  const hasDlp    = /\bDLP\b/i.test(text);

  if (!hasFluoro && !hasDlp) return null;

  const time = extractFluoroTime(text);
  let dose   = extractFluoroDose(text);

  // DLP overrides dose fields if present (same precedence as the SQL)
  if (hasDlp) {
    const dlp = extractDlp(text);
    if (dlp.raw) dose = dlp;
  }

  return {
    fluoroscopy_time_raw:     time.raw,
    fluoroscopy_time_unit:    time.unit,
    fluoroscopy_time_minutes: time.minutes,
    fluoroscopy_dose_raw:     dose.raw,
    fluoroscopy_dose_value:   dose.value,
    fluoroscopy_dose_unit:    dose.unit,
  };
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchReports(conn, limit, reportId) {
  if (reportId) {
    const [rows] = await conn.execute(
      `SELECT ReportID, ContentText FROM reports
       WHERE ReportID = ? AND ContentText IS NOT NULL`,
      [reportId]
    );
    return rows;
  }
  if (limit > 0) {
    const [rows] = await conn.execute(
      `SELECT ReportID, ContentText FROM reports
       WHERE ContentText IS NOT NULL
         AND (ContentText REGEXP 'Fluoroscopy time'
           OR ContentText REGEXP 'Fluoroscopy dose'
           OR ContentText REGEXP 'Reference air kerma'
           OR ContentText REGEXP 'DLP')
       LIMIT ${Number(limit)}`
    );
    return rows;
  }
  const [rows] = await conn.execute(
    `SELECT ReportID, ContentText FROM reports
     WHERE ContentText IS NOT NULL
       AND (ContentText REGEXP 'Fluoroscopy time'
         OR ContentText REGEXP 'Fluoroscopy dose'
         OR ContentText REGEXP 'Reference air kerma'
         OR ContentText REGEXP 'DLP')`
  );
  return rows;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option('dry-run',   { type: 'boolean', default: false })
    .option('write',     { type: 'boolean', default: false })
    .option('limit',     { type: 'number',  default: 100   })
    .option('report-id', { type: 'string',  default: null  })
    .check(argv => {
      if (!argv['dry-run'] && !argv.write) throw new Error('Pass --dry-run or --write.');
      if (argv['dry-run'] && argv.write)   throw new Error('--dry-run and --write are mutually exclusive.');
      return true;
    }).argv;

  let conn;
  try { conn = await mysql.createConnection(getRdsConfig()); }
  catch(e) { console.error('[FATAL]', e.message); process.exit(1); }

  const reports = await fetchReports(conn, argv['report-id'] ? 0 : argv.limit, argv['report-id']);
  console.log(`[INFO] Processing ${reports.length} report(s)…`);

  const extracted = reports
    .map(r => ({ ReportID: r.ReportID, fields: extractAll(r.ContentText) }))
    .filter(r => r.fields !== null);

  console.log(`[INFO] ${extracted.length} report(s) have extractable values.`);

  // ── Dry-run ────────────────────────────────────────────────────────────────
  if (argv['dry-run']) {
    const W = 72;
    console.log('\n' + '═'.repeat(W));
    console.log('  DRY-RUN — extracted values');
    console.log('═'.repeat(W));
    for (const { ReportID, fields } of extracted) {
      console.log(`\n  ReportID: ${ReportID}`);
      for (const [k, v] of Object.entries(fields)) {
        if (v !== null) console.log(`    ${k.padEnd(30)} : ${v}`);
      }
    }
    console.log('\n' + '─'.repeat(W));
    console.log(`  Would update: ${extracted.length} reports`);
    console.log('═'.repeat(W) + '\n');
    console.log('  Run with --write to commit.\n');
    await conn.end();
    return;
  }

  // ── Write ──────────────────────────────────────────────────────────────────
  let updated = 0, errors = 0;
  const PROGRESS = 100;

  for (let i = 0; i < extracted.length; i++) {
    const { ReportID, fields } = extracted[i];
    try {
      await conn.execute(
        `UPDATE reports SET
           fluoroscopy_time_raw     = ?,
           fluoroscopy_time_unit    = ?,
           fluoroscopy_time_minutes = ?,
           fluoroscopy_dose_raw     = ?,
           fluoroscopy_dose_value   = ?,
           fluoroscopy_dose_unit    = ?
         WHERE ReportID = ?`,
        [
          fields.fluoroscopy_time_raw,
          fields.fluoroscopy_time_unit,
          fields.fluoroscopy_time_minutes,
          fields.fluoroscopy_dose_raw,
          fields.fluoroscopy_dose_value,
          fields.fluoroscopy_dose_unit,
          ReportID,
        ]
      );
      updated++;
    } catch(e) {
      errors++;
      console.error(`\n[ERROR] ReportID ${ReportID}: ${e.message}`);
    }

    if ((i + 1) % PROGRESS === 0 || i + 1 === extracted.length)
      process.stdout.write(`  ${i + 1}/${extracted.length} — updated: ${updated}  errors: ${errors}\r`);
  }

  await conn.end();
  console.log('');

  const W = 72;
  console.log('\n' + '═'.repeat(W));
  console.log('  FLUOROSCOPY EXTRACTION COMPLETE');
  console.log('─'.repeat(W));
  console.log(`  Reports processed : ${reports.length}`);
  console.log(`  Reports updated   : ${updated}`);
  if (errors) console.log(`  Errors            : ${errors}`);
  console.log('═'.repeat(W) + '\n');
}

if (require.main === module) main().catch(err => { console.error('\n[FATAL]', err.message); process.exit(1); });