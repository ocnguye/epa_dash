#!/usr/bin/env node
/**
 * scripts/extract_epa.js
 *
 * Reads report_participants (trainees only) and the corresponding
 * ContentText from reports, extracts EPA scores, and writes to epa_scores.
 *
 * Prerequisites: extract_personnel.js and manual_resolve.js must have run
 * first so that report_participants is populated.
 *
 * Unresolved cases (trainee found in text but no matching participant row,
 * or EPA label present but score is NR/missing) are written to:
 *   output/unmatched_epas.csv  → for manual_resolve_epa.js
 *
 * Usage:
 *   node scripts/extract_epa.js --dry-run [--limit N] [--report-id ID]
 *   node scripts/extract_epa.js --write   [--limit N] [--force]
 *
 * Options:
 *   --dry-run      Show what would be written without touching the DB.
 *   --write        Commit to DB.
 *   --limit N      Reports to process (default 100; 0 = all).
 *   --report-id ID Single report by ReportID.
 *   --force        Overwrite existing epa_scores rows.
 */

'use strict';

require('dotenv').config();

const fs    = require('fs');
const path  = require('path');
const mysql = require('mysql2/promise');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

// ─── Output directory ─────────────────────────────────────────────────────────

const OUTPUT_DIR = path.resolve(__dirname, '../output');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function writeCSV(filePath, rows, headers) {
  const escape = v => {
    if (v == null) return '';
    const s = String(v);
    return /[,"\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  };
  const lines = [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))];
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

// ─── DB config ────────────────────────────────────────────────────────────────

function getRdsConfig() {
  const host=process.env.AWS_RDS_HOST, user=process.env.AWS_RDS_USER,
        password=process.env.AWS_RDS_PWD, database=process.env.AWS_RDS_DB,
        port=Number(process.env.AWS_RDS_PORT||3306);
  if (!host||!user||!password||!database)
    throw new Error('Missing env vars: AWS_RDS_HOST, AWS_RDS_USER, AWS_RDS_PWD, AWS_RDS_DB');
  return {host,user,password,database,port,multipleStatements:false};
}

// ─── Name parsing (duplicated from extract_personnel.js) ─────────────────────

function stripPunct(s) { return s ? s.replace(/^\p{P}+|\p{P}+$/gu, '').trim() : ''; }

const REJECT_RE = /^(?:none\.?|n\/a|na|resident|resident\(s\)|trainee|attending|fellow|faculty|note|nr|not\s+present|available|dr\.?|doctor|prof\.?)$/i;
const SUFFIX_RE = /(?:,\s*|\s+)(?:MD|DO|PhD|RN|PA-C|PA|NP|MBBS|FRCR|FRCPC|MSK\s+Radiology\s+Fellow|Radiology\s+Fellow|Fellow|PGY\s*[\d\/\-]+)\.?(?:\s*,.*)?$/i;
const PREFIX_RE = /^(?:Dr\.?|Doctor|Prof\.?|Professor|Mr\.?|Mrs\.?|Ms\.?)\s+/i;
const PAREN_RE  = /\([^)]*\)/g;
const DISCLAIMER_RE     = /[,.]?\s*(?:not\s+present|but\s+readily|available\s+for|for\s+the\s+procedure|readily\s+available).*/gi;
const TRAINING_LEVEL_RE = /\b(?:R|PGY)\s*[-/]?\s*\d+\b/gi;

function cleanName(raw) {
  if (!raw) return null;
  let n = raw.trim()
    .replace(/\s+/g, ' ').replace(PAREN_RE, '').replace(DISCLAIMER_RE, '')
    .replace(SUFFIX_RE, '').replace(PREFIX_RE, '').replace(TRAINING_LEVEL_RE, '')
    .replace(/[\.\s]+$/g, '').trim();
  n = stripPunct(n);
  if (!n || n.length < 2 || /^\d+$/.test(n)) return null;
  if (REJECT_RE.test(n)) return null;
  if (/\b(?:not|but|for|the|available|present|procedure)\b/i.test(n)) return null;
  return n;
}

function stripCredentials(raw) {
  return raw
    .replace(/\bM\.D\.?\b/gi,'MD').replace(/\bD\.O\.?\b/gi,'DO')
    .replace(/\bP\.H\.D\.?\b/gi,'PhD').replace(/\bR\.N\.?\b/gi,'RN')
    .replace(/\bP\.A\-C\.?\b/gi,'PA-C').replace(/\bP\.A\.?\b/gi,'PA')
    .replace(/\bN\.P\.?\b/gi,'NP').replace(/\bM\.B\.B\.S\.?\b/gi,'MBBS')
    .replace(/\bF\.R\.C\.R\.?\b/gi,'FRCR').replace(/\bF\.R\.C\.P\.C\.?\b/gi,'FRCPC')
    .replace(/\b(MD|DO|PhD|RN|PA-C|PA|NP|MBBS|FRCR|FRCPC)\b/gi,'')
    .replace(/\s*[.,]+\s*$/g,'').replace(/\s+/g,' ').trim();
}

function splitNamesLoose(val, knownLastNames) {
  if (!val) return [];
  let s = stripCredentials(val)
    .replace(/\s*;\s*/g,'|').replace(/\s*\/\s*/g,'|').replace(/\s*&\s*/g,'|')
    .replace(/\s+and\s+/gi,'|')
    .replace(/(?<=\b\w{2,})\.\s+(?=[A-Z][a-z])/g,'|')
    .replace(/,\s+(?=[A-Z][a-z]+)/g, (match, offset, str) => {
      const before = str.slice(0, offset).split('|').pop().trim();
      const after  = str.slice(offset + match.length).split(/[|,]/)[0].trim();
      if (before.split(/\s+/).length === 1 && after.split(/\s+/).length === 1) {
        if (knownLastNames && knownLastNames.has(after.toLowerCase())) return '|';
        return ' ';
      }
      return '|';
    });
  return s.split('|').map(p => p.replace(/[.,]+$/,'').trim()).filter(Boolean);
}

function splitByKnownNames(val, knownLastNames) {
  const words = val.split(/\s+/);
  for (let i = 1; i < words.length-1; i++) {
    const w = words[i].toLowerCase().replace(/[^a-z]/g,'');
    if (knownLastNames.has(w) && /^[A-Z]/.test(words[i+1]))
      return [words.slice(0,i+1).join(' '), words.slice(i+1).join(' ')];
  }
  return [val];
}

// ─── Personnel field parsing ──────────────────────────────────────────────────

function getPersonnelFields(text) {
  if (!text) return [];
  const idx = text.search(/Procedural\s+Personnel/i);
  if (idx === -1) return [];
  const raw = text.slice(idx).split(/\n\s*\n/)[0];
  return raw.split(/[ \t]{2,}|\r?\n/).map(s => s.trim()).filter(Boolean);
}

// ─── Participant matching ─────────────────────────────────────────────────────

// Normalise a name for fuzzy comparison
function normName(s) {
  return (s||'').toLowerCase()
    .replace(/\b(dr\.?|doctor|prof\.?|mr\.?|mrs\.?|ms\.?)\s+/gi,'')
    .replace(/\b(md|do|phd|rn|pa-c|pa|np|mbbs|frcr|frcpc|fellow|pgy\s*[\d\/\-]+)\b\.?/gi,'')
    .replace(/\([^)]*\)/g,'')
    .replace(/[^a-z\s]/g,' ')
    .replace(/\s+/g,' ').trim();
}

function nameSimilarity(a, b) {
  if (!a||!b) return 0;
  const aTokens=new Set(a.split(' ')), bTokens=new Set(b.split(' '));
  const aLast=a.split(' ').pop(), bLast=b.split(' ').pop();
  let score = aLast===bLast ? 0.6 : 0;
  let overlap=0; for (const t of aTokens) if(bTokens.has(t)) overlap++;
  score += (overlap/Math.max(aTokens.size,bTokens.size))*0.3;
  if (a[0]&&b[0]&&a[0]===b[0]) score+=0.1;
  return score;
}

// Match a raw name string to one of the known participants for this report.
// Uses the same splitting logic as extract_personnel.js so that e.g.
// "Rodriguez, Chen" is correctly treated as two last-names rather than
// Last, First before attempting any fuzzy match.
function matchParticipant(rawName, normParticipants, knownLastNames) {
  // Split the raw fragment into individual candidate names first
  const candidates = [];
  for (const chunk of splitNamesLoose(rawName, knownLastNames)) {
    for (const name of splitByKnownNames(chunk, knownLastNames)) {
      const c = cleanName(name);
      if (c) candidates.push(c);
    }
  }

  for (const candidate of candidates) {
    const n = normName(candidate);
    if (!n) continue;

    // 1. Exact source_text match
    const exact = normParticipants.find(p => normName(p.source_text) === n);
    if (exact) return exact;

    // 2. Participant source_text is contained within candidate
    //    (e.g. source_text="Chen", candidate="Chen Michael")
    const partial = normParticipants.find(p => {
      const st = normName(p.source_text);
      return st && n.includes(st) && st.length > 2;
    });
    if (partial) return partial;

    // 3. Similarity fallback
    let best=null, bestScore=0;
    for (const p of normParticipants) {
      const s = nameSimilarity(n, p.norm);
      if (s > bestScore) { bestScore=s; best=p; }
    }
    if (normParticipants.length === 1) return normParticipants[0];
    if (bestScore >= 0.5) return best;
  }

  return null;
}

// ─── EPA extraction from ContentText ─────────────────────────────────────────

function extractEpaAssignments(text, participants, reportId, knownLastNames) {
  const fields = getPersonnelFields(text);
  const LABEL_RE = /^Resident(?:\(s\))?\s*(?:PGY\s*[\d\/\-]+\s*)?:\s*(.*)/i;
  const EPA_RE   = /\b(?:Trainee\s+)?EPA\s*[:#]?\s*([1-5NR]?(?:\s*[,;\/&]\s*[1-5])*)/gi;

  const scores    = [];
  const unmatched = [];
  let lastWasResident = false;
  let lastMatchedParticipant = null;

  // Deduplicate scores per participant within this report.
  // A trainee should never have more than one EPA score per report —
  // if the same participantId appears twice we warn and keep the first.
  const seenParticipantIds = new Set();

  const normParticipants = participants.map(p => ({
    ...p,
    norm: normName(`${p.user_first||''} ${p.user_last||''} ${p.source_text||''}`)
  }));

  const processField = (content) => {
    let c = content
      .replace(/\band\s+/gi, '|')
      .replace(/\bTrainee\s*:\s*([1-5]|NR)\b/gi, 'EPA: $1');

    const anchors = [];
    let m;
    const re = new RegExp(EPA_RE.source, 'gi');
    while ((m = re.exec(c)) !== null) {
      const scoreStr = (m[1]||'').trim().toUpperCase();
      const epas = [];
      if (scoreStr && scoreStr !== 'NR')
        for (const dm of scoreStr.matchAll(/\b([1-5])\b/g)) epas.push(parseInt(dm[1],10));
      anchors.push({ index: m.index, end: m.index+m[0].length, epas, raw: m[0], nr: scoreStr==='NR' });
    }

    for (let i=0; i<anchors.length; i++) {
      const anchor=anchors[i], prevEnd=i===0?0:anchors[i-1].end;
      const namePart = c.slice(prevEnd, anchor.index)
        .trim()
        .replace(/\s*Trainee\s*$/i,'')
        .replace(/\|/g,' ')
        .trim();

      let participant = null;
      if (namePart) {
        participant = matchParticipant(namePart, normParticipants, knownLastNames);
        if (participant) lastMatchedParticipant = participant;
      } else {
        participant = lastMatchedParticipant;
      }

      if (anchor.nr || anchor.epas.length===0) {
        if (participant) unmatched.push({ reason:'no_score', participantId:participant.id, rawName:namePart||'(continued)', reportId });
        continue;
      }

      if (!participant) {
        unmatched.push({ reason:'no_participant_match', rawName:namePart, reportId, epas:anchor.epas.join('|') });
        continue;
      }

      if (seenParticipantIds.has(participant.id)) {
        console.warn(`[WARN] Duplicate EPA token for participant ${participant.id} (report ${reportId}, name "${namePart}") — skipping.`);
        continue;
      }
      seenParticipantIds.add(participant.id);

      for (const score of anchor.epas) {
        scores.push({ participantId: participant.id, score });
      }
    }
  };

  for (let fi = 0; fi < fields.length; fi++) {
    const field = fields[fi];

    const andCont = field.match(/^and\s+(.+)/i);
    if (andCont && lastWasResident) { processField(andCont[1].trim()); continue; }

    const lm = field.match(LABEL_RE);
    if (!lm) { lastWasResident = false; continue; }
    lastWasResident = true;

    let content = lm[1].trim();
    if (content && !content.match(/EPA/i)) {
      const next = fields[fi + 1] || '';
      const nextEpa = next.match(/^(?:Trainee\s+)?EPA\s*[:#]?\s*([1-5NR].*)/i);
      if (nextEpa) {
        content = content + '  Trainee EPA: ' + nextEpa[1].trim();
        fi++;
      }
    }

    if (content) processField(content);
  }

  return { scores, unmatched };
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchReportsWithParticipants(conn, limit, reportId) {
  let where = `rp.role = 'trainee'`;
  const params = [];
  if (reportId) { where += ' AND rp.report_id = ?'; params.push(reportId); }

  let sql = `
    SELECT
      rp.id            AS participantId,
      rp.report_id     AS reportId,
      rp.source_text,
      rp.user_id,
      u.first_name     AS user_first,
      u.last_name      AS user_last,
      r.ContentText
    FROM report_participants rp
    JOIN reports r ON r.ReportID = rp.report_id
    LEFT JOIN users u ON u.user_id = rp.user_id
    WHERE ${where}
    ORDER BY rp.report_id
  `;

  if (!reportId && limit > 0) {
    sql = `
      SELECT
        rp.id            AS participantId,
        rp.report_id     AS reportId,
        rp.source_text,
        rp.user_id,
        u.first_name     AS user_first,
        u.last_name      AS user_last,
        r.ContentText
      FROM report_participants rp
      JOIN reports r ON r.ReportID = rp.report_id
      LEFT JOIN users u ON u.user_id = rp.user_id
      WHERE rp.role = 'trainee'
        AND rp.report_id IN (
          SELECT DISTINCT report_id FROM report_participants
          WHERE role = 'trainee' LIMIT ${Number(limit)}
        )
      ORDER BY rp.report_id
    `;
  }

  const [rows] = await conn.execute(sql, params);

  const byReport = new Map();
  for (const row of rows) {
    if (!byReport.has(row.reportId)) {
      byReport.set(row.reportId, { ContentText: row.ContentText, participants: [] });
    }
    byReport.get(row.reportId).participants.push({
      id:          row.participantId,
      source_text: row.source_text,
      user_id:     row.user_id,
      user_first:  row.user_first,
      user_last:   row.user_last,
    });
  }
  return byReport;
}

async function buildLastNames(conn) {
  const [users] = await conn.execute(
    'SELECT last_name FROM users WHERE last_name IS NOT NULL'
  );
  return new Set(users.map(u => u.last_name.trim().toLowerCase()));
}

// ─── DB writes ────────────────────────────────────────────────────────────────

async function writeScore(conn, participantId, score, force) {
  if (force) {
    await conn.execute(
      `INSERT INTO epa_scores (report_participant_id, epa_score)
       VALUES (${Number(participantId)}, ${Number(score)})
       ON DUPLICATE KEY UPDATE
         epa_score = IF(epa_score <=> VALUES(epa_score), epa_score, VALUES(epa_score))`
    );
    return 'written';
  }
  const [existing] = await conn.execute(
    `SELECT id FROM epa_scores WHERE report_participant_id=${Number(participantId)} AND epa_score=${Number(score)}`
  );
  if (existing.length) return 'skipped';
  await conn.execute(
    `INSERT INTO epa_scores (report_participant_id, epa_score) VALUES (${Number(participantId)}, ${Number(score)})`
  );
  return 'written';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option('dry-run',   {type:'boolean',default:false})
    .option('write',     {type:'boolean',default:false})
    .option('limit',     {type:'number', default:100})
    .option('report-id', {type:'string', default:null})
    .option('force',     {type:'boolean',default:false})
    .check(argv=>{
      if (!argv['dry-run']&&!argv.write) throw new Error('Pass --dry-run or --write.');
      if (argv['dry-run']&&argv.write)   throw new Error('--dry-run and --write are mutually exclusive.');
      return true;
    }).argv;

  let conn;
  try { conn = await mysql.createConnection(getRdsConfig()); }
  catch(e) { console.error('[FATAL]',e.message); process.exit(1); }

  console.log('[INFO] Fetching trainee participants and report text…');
  const [byReport, knownLastNames] = await Promise.all([
    fetchReportsWithParticipants(conn, argv['report-id']?0:argv.limit, argv['report-id']),
    buildLastNames(conn),
  ]);
  console.log(`[INFO] Processing ${byReport.size} report(s) with ${knownLastNames.size} known last names…`);

  const allScores=[], allUnmatched=[];

  for (const [reportId, {ContentText, participants}] of byReport) {
    const {scores, unmatched} = extractEpaAssignments(ContentText, participants, reportId, knownLastNames);
    for (const s of scores)    allScores.push({reportId, ...s});
    for (const u of unmatched) allUnmatched.push({...u});
  }

  function printSummary(allScores, allUnmatched, byReport, knownLastNames, writeStats) {
    const totalScores            = allScores.length;
    const unmatchedNoScore       = allUnmatched.filter(u=>u.reason==='no_score').length;
    const unmatchedNoParticipant = allUnmatched.filter(u=>u.reason==='no_participant_match').length;
    const totalAttempted         = totalScores + unmatchedNoParticipant;
    const pct = (n,d) => d ? `${((n/d)*100).toFixed(1)}%` : 'n/a';
    const W=72, LINE='═'.repeat(W), DASH='─'.repeat(W);
    const row=(l,v)=>console.log(`  ${l.padEnd(38)} : ${v}`);
    console.log('\n'+LINE); console.log('  EPA EXTRACTION SUMMARY'); console.log(LINE);
    row('Reports processed',         byReport.size);
    row('Known last names loaded',   knownLastNames.size);
    console.log(DASH);
    row('Total EPA slots found',     totalAttempted);
    row('  Assigned to participant', `${totalScores}  (${pct(totalScores, totalAttempted)})`);
    row('  No participant match',    `${unmatchedNoParticipant}  (${pct(unmatchedNoParticipant, totalAttempted)})`);
    console.log(DASH);
    row('Total scores assigned',     totalScores);
    if (writeStats) {
      row('  Written to DB',         `${writeStats.written}  (${pct(writeStats.written, totalScores)})`);
      row('  Already existed',       `${writeStats.skipped}  (${pct(writeStats.skipped, totalScores)})`);
    } else {
      row('  Would be written',      `${totalScores}  (dry-run)`);
    }
    row('  NR / missing score',      unmatchedNoScore);
    if (writeStats?.errors) { console.log(DASH); row('Errors', writeStats.errors); }
    console.log(LINE+'\n');
  }

  // ── Dry-run ────────────────────────────────────────────────────────────────
  if (argv['dry-run']) {
    console.log('\n'+'═'.repeat(72));
    console.log('  DRY-RUN — EPA score assignments'); console.log('═'.repeat(72));
    for (const s of allScores)
      console.log(`  report=${s.reportId}  participant=${s.participantId}  score=${s.score}`);
    if (allUnmatched.length) {
      console.log('\n  Unmatched:');
      for (const u of allUnmatched)
        console.log(`  report=${u.reportId}  reason=${u.reason}  name="${u.rawName||''}"  epas=${u.epas||''}`);
    }
    printSummary(allScores, allUnmatched, byReport, knownLastNames, null);
    console.log('  No data was written. Run with --write to commit.\n');
    await conn.end(); return;
  }

  // ── Write ──────────────────────────────────────────────────────────────────
  let written=0, skipped=0, errors=0;
  const PROGRESS=500;

  for (let i=0; i<allScores.length; i++) {
    const {participantId, score, reportId} = allScores[i];
    try {
      const status = await writeScore(conn, participantId, score, argv.force);
      if (status==='written') written++; else skipped++;
    } catch(e) {
      errors++;
      console.error(`\n[ERROR] report=${reportId} participant=${participantId} score=${score}: ${e.message}`);
    }
    if ((i+1)%PROGRESS===0||i+1===allScores.length)
      process.stdout.write(`  ${i+1}/${allScores.length} — written: ${written}  skipped: ${skipped}  errors: ${errors}\r`);
  }

  await conn.end();
  console.log('');

  printSummary(allScores, allUnmatched, byReport, knownLastNames, {written, skipped, errors});


  const unmatchedFile = 'unmatched_epas.csv';
  writeCSV(path.join(OUTPUT_DIR, unmatchedFile),
    allUnmatched.map(u=>({reportId:u.reportId,participantId:u.participantId||'',reason:u.reason,rawName:u.rawName||'',epas:u.epas||''})),
    ['reportId','participantId','reason','rawName','epas']
  );
  console.log(`[INFO] ${unmatchedFile}: ${allUnmatched.length} rows`);
  console.log(`[INFO]   no_participant_match : ${unmatchedNoParticipant}`);
  console.log(`[INFO]   no_score (NR/blank)  : ${unmatchedNoScore}`);
  if (allUnmatched.length)
    console.log(`[INFO] Next: node scripts/manual_resolve_epa.js --input output/${unmatchedFile}`);
}

if (require.main===module) main().catch(err=>{console.error('\n[FATAL]',err.message);process.exit(1);});