#!/usr/bin/env node
/*
  scripts/import_excel_to_reports.js

  Usage:
    node scripts/import_excel_to_reports.js /absolute/path/to/file.xlsx

  Required env vars:
    AWS_RDS_HOST
    AWS_RDS_USER
    AWS_RDS_PASS
    AWS_RDS_DB
    AWS_RDS_PORT (optional, defaults to 3306)

  Dependencies:
    npm install xlsx mysql2 dotenv
*/

require('dotenv').config();

const xlsx = require('xlsx');
const mysql = require('mysql2/promise');
const path = require('path');

function normalize(s) {
  if (!s) return '';
  return String(s).trim().toLowerCase().replace(/\s+/g, ' ');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toMySQLDate(d) {
  if (!(d instanceof Date) || isNaN(d)) return null;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
         `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function parseExcelDate(v) {
  if (!v) return null;
  if (v instanceof Date) return toMySQLDate(v);

  const d = new Date(v);
  if (!isNaN(d)) return toMySQLDate(d);

  return null;
}

/**
 * reports table columns (order matters)
 */
const targetColumns = [
  'ReportID',
  'ContentText',
  'CreateDate',
  'Accession',
  'ReasonForStudy',
  'ProcedureCodeList',
  'ProcedureDescList',
  'epa',
  'attending',
  'trainee'
];

/**
 * Excel header → SQL column mapping
 */
const headerAliases = {
  'reportid': 'ReportID',
  'result_text': 'ContentText',
  'exam_final_date': 'CreateDate',
  'accession_num': 'Accession',
  'proc_code_list': 'ProcedureCodeList',
  'proc_name': 'ProcedureDescList',
  'dictator': 'trainee',
  'signer': 'attending',
  'epa': 'epa'
};

function mapHeaders(headers) {
  const map = {};
  headers.forEach((h, i) => {
    const key = normalize(h).replace(/[^a-z0-9_]/g, '');
    map[i] = headerAliases[key] || null;
  });
  return map;
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv[0]) {
    console.error('Usage: node scripts/import_excel_to_reports.js /path/to/file.xlsx');
    process.exit(1);
  }

  const filePath = path.resolve(argv[0]);

  // 🔐 RDS CONFIG — must already work in your other script
  const host = process.env.AWS_RDS_HOST;
  const user = process.env.AWS_RDS_USER;
  const password = process.env.AWS_RDS_PWD;
  const database = process.env.AWS_RDS_DB;
  const port = Number(process.env.AWS_RDS_PORT || 3306);

  if (!host || !user || !password || !database) {
    throw new Error('Missing required RDS environment variables');
  }

  console.log('DB CONFIG CHECK:', { host, user, database, port });

  console.log('Reading Excel:', filePath);
  const wb = xlsx.readFile(filePath, { cellDates: true });
  const sheet = wb.SheetNames[0];
  const rowsRaw = xlsx.utils.sheet_to_json(wb.Sheets[sheet], { defval: null });

  if (!rowsRaw.length) {
    console.error('No rows found in Excel.');
    process.exit(1);
  }

  const headers = Object.keys(rowsRaw[0]);
  const headerMap = mapHeaders(headers);

  console.log('Header mapping:');
  headers.forEach((h, i) =>
    console.log(`${h} -> ${headerMap[i] || '<ignored>'}`)
  );

  const rows = rowsRaw.map(r => {
    const row = targetColumns.map(() => null);

    headers.forEach((h, i) => {
      const col = headerMap[i];
      if (!col) return;

      const idx = targetColumns.indexOf(col);
      if (idx === -1) return;

      let val = r[h];
      if (col === 'CreateDate') val = parseExcelDate(val);

      row[idx] = val;
    });

    return row; // ReasonForStudy intentionally NULL
  });

  console.log(`Connecting to RDS ${database} @ ${host}:${port}`);
  const conn = await mysql.createConnection({
    host,
    user,
    password,
    database,
    port
  });

  const colsSQL = targetColumns.map(c => `\`${c}\``).join(',');
  const rowPlaceholder = '(' + targetColumns.map(() => '?').join(',') + ')';
  const updateClause = targetColumns
    .map(c => `\`${c}\`=VALUES(\`${c}\`)`)
    .join(',');

  const batchSize = 200;
  let processed = 0;

  try {
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const placeholders = batch.map(() => rowPlaceholder).join(',');
      const values = batch.flat();

      const sql = `
        INSERT INTO reports (${colsSQL})
        VALUES ${placeholders}
        ON DUPLICATE KEY UPDATE ${updateClause}
      `;

      await conn.execute(sql, values);
      processed += batch.length;
      process.stdout.write(`Imported ${processed}/${rows.length}\r`);
    }

    console.log('\nImport complete.');
  } finally {
    await conn.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
