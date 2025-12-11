#!/usr/bin/env node
/*
  scripts/import_excel_to_report_summary.js

  Usage (preferred: use env vars):
    DB_HOST, DB_USER, DB_PASS, DB_NAME can be set as env vars.
    node scripts/import_excel_to_report_summary.js /absolute/path/to/file.xlsx

  Or pass CLI args:
    node scripts/import_excel_to_report_summary.js /path/to/file.xlsx host user pass database [sheetName]

  Dependencies:
    npm install xlsx mysql2

  What it does:
    - Reads the first sheet (or provided sheet name) from the Excel file
    - Normalizes headers and maps them to the `rpr_reports` column names
    - Inserts rows in batches using prepared statements
    - Uses INSERT INTO ... ON DUPLICATE KEY UPDATE to avoid duplicate primary key insert errors

  Notes:
    - Adjust `headerAliases` in the mapping if your Excel uses different header names.
    - Make sure the DB user has INSERT and CREATE/ALTER privileges (if needed).
*/

const xlsx = require('xlsx');
const mysql = require('mysql2/promise');
const path = require('path');

function normalize(s) {
  if (s === null || s === undefined) return '';
  return String(s).trim().toLowerCase().replace(/\s+/g, ' ');
}

// The canonical target columns in rpr_reports (order matters for inserts)
const targetColumns = [
  'Accession', 'Modality', 'ProcedureName', 'PatientClass', 'FEEDBACK',
  'FIRST_RESIDENT', 'SIGNING_MD', 'CREATEDATE', 'ORDERING_DATE_TIME',
  'EXAM_BEGUN_DATE', 'EXAM_ENDED_DATE', 'EXAM_FINAL_DATE',
  'FIRST_PRELIM_RESIDENT', 'SECOND_RESIDENT', 'SECOND_PRELIM_RESIDENT',
  'DICTATING_RESIDENT', 'TRAUMA_LEVEL', 'Hospital', 'PrelimReport', 'FinalReport'
];

// Known header aliases (lowercased normalized header -> canonical column)
// Extend this map if your Excel uses other header names.
const headerAliases = {
  'accession': 'Accession',
  'acc #': 'Accession',
  'modality': 'Modality',
  'procedure': 'ProcedureName',
  'procedure name': 'ProcedureName',
  'patient class': 'PatientClass',
  'patientclass': 'PatientClass',
  'feedback': 'FEEDBACK',
  'feedback status': 'FEEDBACK',
  'first resident': 'FIRST_RESIDENT',
  'signing md': 'SIGNING_MD',
  'createdate': 'CREATEDATE',
  'create date': 'CREATEDATE',
  'ordering_date_time': 'ORDERING_DATE_TIME',
  'ordering date': 'ORDERING_DATE_TIME',
  'exam begun date': 'EXAM_BEGUN_DATE',
  'exam begun': 'EXAM_BEGUN_DATE',
  'exam ended date': 'EXAM_ENDED_DATE',
  'exam final date': 'EXAM_FINAL_DATE',
  'first prelim resident': 'FIRST_PRELIM_RESIDENT',
  'second resident': 'SECOND_RESIDENT',
  'second prelim resident': 'SECOND_PRELIM_RESIDENT',
  'dictating resident': 'DICTATING_RESIDENT',
  'trauma level': 'TRAUMA_LEVEL',
  'hospital': 'Hospital',
  'prelim report': 'PrelimReport',
  'final report': 'FinalReport'
};

function mapHeadersToColumns(headers) {
  // headers: array of original header strings
  const map = {};
  for (let i = 0; i < headers.length; i++) {
    const raw = headers[i];
    const key = normalize(raw);
    if (headerAliases[key]) {
      map[i] = headerAliases[key];
    } else if (targetColumns.includes(raw)) {
      map[i] = raw;
    } else if (targetColumns.includes(capitalizeWords(raw))) {
      map[i] = capitalizeWords(raw);
    } else {
      // try to heuristically match by removing punctuation
      const simple = key.replace(/[^a-z0-9 ]/g, '');
      if (headerAliases[simple]) map[i] = headerAliases[simple];
      else map[i] = null; // not mapped
    }
  }
  return map;
}

function capitalizeWords(s) {
  if (!s) return s;
  return s.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Date handling helpers
function twoDigitYearToFull(y) {
  // convert 2-digit year to 20xx (assume 2000-2099)
  const n = Number(y);
  if (Number.isNaN(n)) return null;
  return n < 100 ? 2000 + n : n;
}

function pad2(n) { return String(n).padStart(2, '0'); }

function toMySQLDateFromJSDate(d) {
  if (!(d instanceof Date) || isNaN(d)) return null;
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// Parse common Excel-formatted date strings like "5/10/23 4:57 PM" or "05/10/2023 16:57"
function parseExcelDateString(v) {
  if (v === null || typeof v === 'undefined') return null;
  if (v instanceof Date) return toMySQLDateFromJSDate(v);
  const s = String(v).trim();
  // Try ISO parse first
  const iso = new Date(s);
  if (!isNaN(iso)) return toMySQLDateFromJSDate(iso);

  // Match patterns like M/D/YY[YY] h:mm [AM|PM]
  const re = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})[\sT]+(\d{1,2}):(\d{2})(?:\s*([APap][Mm]))?$/;
  const m = s.match(re);
  if (m) {
    let mo = Number(m[1]);
    let day = Number(m[2]);
    let yr = Number(m[3]);
    const hourRaw = Number(m[4]);
    const min = Number(m[5]);
    const ampm = m[6];
    if (String(m[3]).length === 2) yr = twoDigitYearToFull(yr) || yr;
    let hour = hourRaw;
    if (ampm) {
      const up = ampm.toUpperCase();
      if (up === 'PM' && hour !== 12) hour = hour + 12;
      if (up === 'AM' && hour === 12) hour = 0;
    }
    const d = new Date(yr, mo - 1, day, hour, min, 0);
    return toMySQLDateFromJSDate(d);
  }

  // Fallback: return original string (MySQL may try to parse or insert NULL)
  return s;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 1) {
    console.error('Usage: node scripts/import_excel_to_report_summary.js /path/to/file.xlsx [host user pass db [sheetName]]');
    process.exit(1);
  }

  const filePath = path.resolve(argv[0]);
  const host = process.env.AWS_RDS_HOST || argv[1] || 'localhost';
  const user = process.env.AWS_RDS_USER || argv[2] || 'root';
  const password = process.env.AWS_RDS_PASS || argv[3] || '';
  const database = process.env.AWS_RDS_DB || argv[4] || 'powerscribe';
  // Optional port: env AWS_RDS_PORT or argv[5]
  const port = process.env.AWS_RDS_PORT || argv[5] || 3306;
  // Optional sheetName: if using port via env, pass sheetName as argv[6]
  const sheetName = argv[6] || null;

  console.log('Reading Excel:', filePath);
  const wb = xlsx.readFile(filePath, { cellDates: true });
  const sheet = sheetName || wb.SheetNames[0];
  console.log('Using sheet:', sheet);
  const rawRows = xlsx.utils.sheet_to_json(wb.Sheets[sheet], { defval: null, raw: false });
  if (!rawRows || rawRows.length === 0) {
    console.error('No rows found in sheet. Exiting.');
    process.exit(1);
  }

  // Derive headers
  const headers = Object.keys(rawRows[0]);
  const headerMap = mapHeadersToColumns(headers);

  console.log('Detected headers:');
  headers.forEach((h, i) => console.log(`${i}: ${h} -> ${headerMap[i] || '<ignored>'}`));

  // Build rows in target column order
  const dateColumns = new Set(['CREATEDATE','ORDERING_DATE_TIME','EXAM_BEGUN_DATE','EXAM_ENDED_DATE','EXAM_FINAL_DATE']);
  const rows = rawRows.map(r => {
    const rowArray = targetColumns.map(() => null);
    headers.forEach((h, i) => {
      const col = headerMap[i];
      if (!col) return;
      const targetIndex = targetColumns.indexOf(col);
      if (targetIndex >= 0) {
        let val = r[h];
        // Normalize dates for known date columns
        if (val != null && dateColumns.has(col)) {
          // If xlsx gave JS Date objects (raw: true) or strings (raw: false), handle both
          val = parseExcelDateString(val);
        }
        rowArray[targetIndex] = val;
      }
    });
    return rowArray;
  });

  // DB connection
  // Print connection attempt info (DO NOT print password)
  console.log(`Attempting DB connection to ${host}:${port} as ${user} (database: ${database})`);
  const conn = await mysql.createConnection({ host, user, password, database, port: Number(port), multipleStatements: true });
  console.log('Connected to DB', database, '@', `${host}:${port}`);

  // Prepare insert statement using placeholders for batch inserts
  const colList = targetColumns.map(c => `\`${c}\``).join(', ');
  const placeholdersRow = '(' + targetColumns.map(() => '?').join(',') + ')';

  // ON DUPLICATE KEY UPDATE: simple no-op update to avoid errors but keep row stable
  const updateClause = targetColumns.map(c => `\`${c}\`=VALUES(\`${c}\`)`).join(', ');

  const batchSize = 200; // tune as needed
  let inserted = 0;
  try {
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const valuePlaceholders = batch.map(() => placeholdersRow).join(',');
      const flatValues = batch.flat();
  const sql = `INSERT INTO \`rpr_reports\` (${colList}) VALUES ${valuePlaceholders} ON DUPLICATE KEY UPDATE ${updateClause}`;
      const [res] = await conn.execute(sql, flatValues);
      inserted += batch.length;
      process.stdout.write(`Inserted/Upserted rows: ${inserted}/${rows.length}\r`);
    }
    console.log('\nDone.');
  } catch (err) {
    console.error('Error during insert:', err);
  } finally {
    await conn.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
