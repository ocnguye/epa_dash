#!/usr/bin/env node
// scripts/import_reports_parse.js
// Node.js reimplementation of the provided Python import/enrich script.

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const RDS_CONFIG = {
  host: process.env.RDS_HOST || process.env.AWS_RDS_HOST,
  database: process.env.RDS_DB || process.env.AWS_RDS_DB,
  user: process.env.RDS_USER || process.env.AWS_RDS_USER,
  password: process.env.RDS_PWD || process.env.AWS_RDS_PWD || process.env.AWS_RDS_PWD || process.env.AWS_RDS_PASS,
  port: Number(process.env.RDS_PORT || process.env.AWS_RDS_PORT || 3306),
  multipleStatements: false,
};

const RDS_TABLE = process.env.RDS_TABLE || 'reports';

const SCAN_PATTERNS = [
  [/(\bct\b|\bcomputed tomography\b)/i, 'CT'],
  [/(\bmri\b|\bmagnetic resonance\b)/i, 'MRI'],
  [/(x-?ray|\bxr\b)/i, 'X-Ray'],
  [/(ultrasound|\bus\b)/i, 'Ultrasound'],
  [/\bpet\b/i, 'PET'],
];

const EXTRA_COLUMNS = {
  epa: 'TEXT',
  attending: 'VARCHAR(128)',
  trainee: 'TEXT',
  scan_type: 'VARCHAR(64)'
};

function extractScanType(text) {
  if (!text || typeof text !== 'string') return null;
  for (const [pat, name] of SCAN_PATTERNS) {
    if (pat.test(text)) return name;
  }
  return null;
}

// Extract multiple EPA identifiers from the report. Returns an array of unique EPA ids (strings).
function extractEpas(text) {
  if (!text || typeof text !== 'string') return [];

  // First try to limit to Procedural Personnel block if present (prefer local context)
  const pmMatch = text.match(/Procedural\s+Personnel\s*:?[\s\S]*?(?=\n\s*\n|$)/i);
  const scope = pmMatch ? pmMatch[0] : text;

  const found = new Set();

  // Pattern 1: explicit 'Trainee EPA' or 'TraineeEPA' or 'Trainee EPA:' variants followed by one or more identifiers
  // Capture groups of numbers and hashes that commonly represent EPA ids (allow hyphens)
  const reExplicit = /(?:Trainee\s*EPA\b[^\d#\n\r:-]*[:#-]?\s*)([0-9][0-9\-]*(?:[\s,;&\/]?[0-9][0-9\-]*)*)/gi;
  let m;
  while ((m = reExplicit.exec(scope)) !== null) {
    const chunk = m[1];
    if (!chunk) continue;
    // split on non-digit/hyphen separators
    const parts = chunk.split(/[\s,;\/&]+/).map(s => s.trim()).filter(Boolean);
    for (const p of parts) {
      const norm = p.replace(/[^0-9\-]/g, '').replace(/^-+|-+$/g, '');
      if (norm) found.add(norm);
    }
  }

  // Pattern 2: generic 'EPA' tokens elsewhere followed by numbers
  const reGeneric = /\bEPA\b[^\d#\n\r:-]*[:#-]?\s*([0-9][0-9\-]*(?:[\s,;&\/]?[0-9][0-9\-]*)*)/gi;
  while ((m = reGeneric.exec(scope)) !== null) {
    const chunk = m[1];
    if (!chunk) continue;
    const parts = chunk.split(/[\s,;\/&]+/).map(s => s.trim()).filter(Boolean);
    for (const p of parts) {
      const norm = p.replace(/[^0-9\-]/g, '').replace(/^-+|-+$/g, '');
      if (norm) found.add(norm);
    }
  }

  // Pattern 3: any standalone '#' followed by numbers across the scope
  const reHash = /#\s*([0-9][0-9\-]*)/g;
  while ((m = reHash.exec(scope)) !== null) {
    const norm = (m[1] || '').replace(/[^0-9\-]/g, '');
    if (norm) found.add(norm);
  }

  // Pattern 4: fallback: any 5+ digit token (heuristic) in scope
  const reDigits = /\b([0-9]{4,})\b/g;
  while ((m = reDigits.exec(scope)) !== null) {
    const token = m[1];
    if (token && token.length >= 4) found.add(token);
  }

  return Array.from(found);
}

function _stripUnicodePunct(s) {
  if (!s) return s;
  // Remove leading/trailing punctuation and whitespace
  return s.replace(/^\p{P}+|\p{P}+$/gu, '').trim();
}

function extractAttending(text) {
  if (!text || typeof text !== 'string') return null;
  const pmMatch = text.match(/Procedural\s+Personnel\s*:?[\s\S]*?(?=\n\s*\n|$)/i);
  if (!pmMatch) return null;
  let block = pmMatch[0];

  // Remove advanced practice provider lines
  block = block.replace(/^\s*Advanced\s+practice\s+provider(?:\(s\))?\s*:\s*.*$/gim, '');
  block = block.replace(/Advanced\s+practice\s+provider/gi, ' ');

  const lines = block.split(/\r?\n/);
  let val = null;
  for (const line of lines) {
    if (/\bAttending\b/i.test(line)) {
      const idx = line.search(/\bAttending\b/i);
      const colon = line.indexOf(':', idx);
      if (colon !== -1) {
        val = line.slice(colon + 1).trim();
      } else {
  val = line.replace(/^.*\bAttending\b(?:\s*\(s\))?(?:\s+physician(?:s)?)?(?:\s*\(s\))?[:\-]?\s*/i, '').trim();
      }
      break;
    }
  }

  if (!val) {
  const m = block.match(/Attending(?:s)?(?:\s*\(s\))?(?:\s+physician(?:s)?)?\s*[:\-]?\s*(.*)/i);
    if (!m) return null;
    val = (m[1] || '').split(/\r?\n/)[0].trim();
  }

  if (!val) return null;
  val = val.replace(/Trainee\s+EPA\b.*/i, '').trim();
  val = val.replace(/[\.\s]+$/g, '').trim();

  // split multiple attendings conservatively
  const parts = val.split(/\s*(?:;|\/|&|\band\b)\s*/i).map(p => p.trim()).filter(Boolean);
  const cleaned = [];
  for (let p of parts) {
    p = p.replace(/^\s*(?:Dr\.?|Doctor|Prof\.?|Professor|Mr\.?|Mrs\.?|Ms\.?)\s+/i, '');
    p = p.replace(/\([^)]*\)/g, '');
    p = p.replace(/(?:,\s*)?\b(?:MD|DO|PhD|RN|PA|NP|MBBS)\b\.?/i, '').trim();
    p = _stripUnicodePunct(p);
    if (!p) continue;
    if (!/^(none|n\/a)$/i.test(p)) cleaned.push(p);
  }
  // dedupe preserve order
  const seen = new Set();
  const ordered = [];
  for (const n of cleaned) {
    if (!seen.has(n)) {
      seen.add(n);
      ordered.push(n);
    }
  }
  return ordered.length ? ordered.join('; ') : null;
}

function extractTrainee(text) {
  if (!text || typeof text !== 'string') return null;
  const pmMatch = text.match(/Procedural\s+Personnel\s*:?[\s\S]*?(?=\n\s*\n|$)/i);
  if (!pmMatch) return null;
  let block = pmMatch[0];
  block = block.replace(/^\s*Advanced\s+practice\s+provider(?:\(s\))?\s*:\s*.*$/gim, '');
  block = block.replace(/ResidentPGY[0-9/\-]*[:\.]?\s*/gi, '');

  const trainees = [];
  const labelPatterns = [/Resident\(s\)\s*PGY6\/?7/i, /Resident\(s\)\s*PGY1-5/i, /Resident\(s\)\s*PGY[0-9/\- ]+/i];
  for (const lab of labelPatterns) {
  const re = new RegExp('^\s*' + lab.source + '\s*:\s*(.*)$', 'gim');
    let m;
    while ((m = re.exec(block)) !== null) {
      let raw = (m[1] || '').trim();
      if (!raw) {
        // take next non-empty line
        const rest = block.slice(m.index + m[0].length);
        const lines = rest.split(/\r?\n/);
        for (const ln of lines) {
          const candidate = ln.trim();
          if (candidate && !/^[A-Za-z\s]{1,40}:$/.test(candidate)) {
            raw = candidate; break;
          }
        }
      }
      if (!raw || /^(none|n\/a)$/i.test(raw)) continue;
  raw = raw.replace(/^\s*PGY[0-9/\-]+[:\.\s-]*/i, '');
  raw = raw.split(/Trainee\s*EPA/i)[0];
  raw = raw.split(/EPA\b/i)[0];
  raw = raw.split(/Advanced\s*practice\s*provider\b/i)[0];
      const parts = raw.split(/\s*(?:;|\/|&|\band\b)\s*/i);
      for (let p of parts) {
        let name = p.replace(/\s+/g, ' ').trim();
        name = name.replace(/[\.\s]+$/g, '').trim();
  name = name.replace(/^Resident(?:\(s\))?[:\.]?\s*/i, '');
  name = name.replace(/^ResidentPGY[0-9/\-]*[:\.]?\s*/i, '');
  name = name.replace(/^PGY[0-9/\-]+[:\.]?\s*/i, '');
  name = name.replace(/Advanced\s*practice\s*provider\s*[:\.]?\s*/i, '');
  name = name.replace(/Trainee\s*[:\-]*\s*$/i, '');
  name = name.replace(/Trainee\s*EPA\s*[:#]*\s*$/i, '');
        name = name.replace(/^(?:Dr\.?|Doctor|Prof\.?|Professor|Mr\.?|Mrs\.?|Ms\.?)\s+/i, '');
        name = name.replace(/\([^)]*\)/g, '');
        name = name.replace(/(?:,\s*)?(?:MD|DO|PhD|RN|PA|NP|MBBS)\.?$/i, '').trim();
        if (!name) continue;
        const low = name.toLowerCase();
        if (['none','n/a','resident','resident(s)'].includes(low)) continue;
        trainees.push(name);
      }
    }
  }
  if (trainees.length) {
    const seen = new Set();
    const ordered = [];
    for (const n of trainees) {
      if (!seen.has(n)) { seen.add(n); ordered.push(n); }
    }
    return ordered.join('; ');
  }
  // fallback: try to capture the name before 'Trainee EPA: <num>'
  const fallback = block.match(/([A-Z][A-Za-z\.'\-\s]{1,100}?)\s+Trainee\s+EPA\s*[:#]?\s*([0-9][0-9\-]*)/i);
  if (fallback) {
    let name = fallback[1].trim();
    name = name.replace(/ResidentPGY[0-9/\-]*/i, '').trim();
    name = name.replace(/Advanced\s+practice\s+provider\s*:\s*/i, '').trim();
    name = name.replace(/^(?:Dr\.?|Doctor|Prof\.?|Professor|Mr\.?|Mrs\.?|Ms\.?)\s+/i, '').trim();
    name = name.replace(/\([^)]*\)/g, '');
    name = name.replace(/(?:,\s*)?(?:MD|DO|PhD|RN|PA|NP|MBBS)\.?$/i, '').trim();
    if (name && !/resident|trainee|epa/i.test(name)) return name;
  }
  return null;
}

async function fetchReports(limit = 100) {
  let conn;
  try {
    conn = await mysql.createConnection(RDS_CONFIG);
    const [rows] = await conn.execute(`SELECT ReportID, ContentText FROM ${RDS_TABLE} WHERE ContentText IS NOT NULL LIMIT ?`, [limit]);
    return rows;
  } catch (e) {
    console.error('[ERROR] fetching reports:', e.message || e);
    return [];
  } finally {
    if (conn) await conn.end();
  }
}

function enrichRows(rows) {
  return rows.map(r => {
    const text = r.ContentText || '';
    const scan_type = extractScanType(text);
    const epas = extractEpas(text); // array
    const attending = extractAttending(text);
    const trainee = extractTrainee(text);
    return {
      ReportID: r.ReportID,
      ContentText: text,
      epa: epas.length ? epas.join('; ') : null,
      epa_array: epas,
      attending: attending,
      trainee: trainee,
      scan_type: scan_type,
    };
  });
}

async function ensureRdsColumns(conn) {
  const cur = conn;
  const [cols] = await conn.execute(
    'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [RDS_CONFIG.database, RDS_TABLE]
  );
  const existing = new Set(cols.map(r => String(r.COLUMN_NAME).toLowerCase()));
  for (const [col, colType] of Object.entries(EXTRA_COLUMNS)) {
    if (!existing.has(col.toLowerCase())) {
      const sql = `ALTER TABLE ${RDS_TABLE} ADD COLUMN ${col} ${colType}`;
      try {
        await conn.execute(sql);
        console.log(`[INFO] Added column ${col} ${colType} to ${RDS_TABLE}`);
      } catch (e) {
        console.warn(`[WARN] Could not add column ${col}:`, e.message || e);
      }
    }
  }
}

async function insertIntoRds(rows, force = false) {
  if (!rows || !rows.length) return 0;
  let conn;
  try {
    conn = await mysql.createConnection(RDS_CONFIG);
    await ensureRdsColumns(conn);
    const cols = ['ReportID', 'ContentText', ...Object.keys(EXTRA_COLUMNS)];
    const placeholders = cols.map(() => '?').join(', ');
    const colListSql = cols.join(', ');
    const updateSql = cols.filter(c => c !== 'ReportID').map(c => `${c} = ${force ? 'VALUES(' + c + ')' : `COALESCE(VALUES(${c}), ${c})`}`).join(', ');
    const insertSql = `INSERT INTO ${RDS_TABLE} (${colListSql}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updateSql};`;

    await conn.beginTransaction();
    const stmt = insertSql;
    for (const r of rows) {
      const values = [r.ReportID, r.ContentText, r.epa, r.attending, r.trainee, r.scan_type];
      await conn.execute(stmt, values);
    }
    await conn.commit();
    console.log(`[INFO] Inserted/updated ${rows.length} rows into '${RDS_TABLE}'.`);
    return rows.length;
  } catch (e) {
    if (conn) {
      try { await conn.rollback(); } catch (er) { }
    }
    console.error('[ERROR] Inserting into RDS:', e.message || e);
    return 0;
  } finally {
    if (conn) await conn.end();
  }
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option('limit', { type: 'number', default: 100 })
    .option('dry-run', { type: 'boolean', default: false })
    .option('write', { type: 'boolean', default: false })
    .option('force', { type: 'boolean', default: false })
    .argv;

  const rows = await fetchReports(argv.limit);
  if (!rows || !rows.length) { console.log('[INFO] No rows fetched.'); return; }
  const enriched = enrichRows(rows);

  // Print summary stats similar to Python script
  const total = enriched.length;
  const haveEpa = enriched.filter(r => r.epa).length;
  const haveAtt = enriched.filter(r => r.attending).length;
  const haveTrainee = enriched.filter(r => r.trainee).length;
  console.log(`[INFO] Processed ${total} reports — EPA extracted in ${haveEpa}; attending parsed in ${haveAtt}; trainee parsed in ${haveTrainee}.`);

  if (haveEpa > 0) {
    console.log('[SAMPLE] Extracted EPA values (first 50):');
    for (const r of enriched.filter(r => r.epa).slice(0, 50)) {
      console.log(` - ReportID=${r.ReportID}: EPA=${r.epa}`);
    }
  }
  if (haveAtt > 0) {
    console.log('[SAMPLE] Extracted attending values (first 50):');
    for (const r of enriched.filter(r => r.attending).slice(0, 50)) {
      console.log(` - ReportID=${r.ReportID}: attending=${r.attending}`);
    }
  }

  if (argv['dry-run']) {
    console.log('[DRY-RUN] Done (no DB writes).');
    return;
  }

  if (argv.write) {
    const written = await insertIntoRds(enriched, argv.force);
    if (written) console.log(`[COMPLETE] Wrote ${written} rows to '${RDS_TABLE}'.`);
    else console.log('[COMPLETE] No rows were written to the database.');
  }
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}
