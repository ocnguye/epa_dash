#!/usr/bin/env node
/**
 * scripts/extract_personnel.js
 *
 * Extracts attending and trainee names from reports.ContentText and writes
 * to report_participants. EPA scores are handled separately by extract_epa.js.
 *
 * Resolution order for each extracted name:
 *   1. users table (exact + transposition matching, role-scoped)
 *   2. user_name_aliases table (manually confirmed mappings from manual_resolve.js)
 *   3. Unresolved → written to unmatched_people.csv for manual_resolve.js
 *      (names that already exist in user_name_aliases are excluded from this file)
 *
 * Usage:
 *   node scripts/extract_personnel.js --dry-run [--limit N] [--report-id ID]
 *   node scripts/extract_personnel.js --write   [--limit N] [--force]
 *
 * Options:
 *   --dry-run      Show extraction results without writing.
 *   --write        Commit to DB.
 *   --limit N      Reports to process (default 100; 0 = all).
 *   --report-id ID Single report by ReportID.
 *   --force        Overwrite existing participant rows.
 */

'use strict';

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
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
    return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))];
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

// ─── DB config ────────────────────────────────────────────────────────────────

function getRdsConfig() {
  const host = process.env.AWS_RDS_HOST, user = process.env.AWS_RDS_USER,
        password = process.env.AWS_RDS_PWD, database = process.env.AWS_RDS_DB,
        port = Number(process.env.AWS_RDS_PORT || 3306);
  if (!host || !user || !password || !database)
    throw new Error('Missing env vars: AWS_RDS_HOST, AWS_RDS_USER, AWS_RDS_PWD, AWS_RDS_DB');
  return { host, user, password, database, port, multipleStatements: false };
}

// ─── Name cleaning ────────────────────────────────────────────────────────────

function stripPunct(s) { return s ? s.replace(/^\p{P}+|\p{P}+$/gu, '').trim() : ''; }

const REJECT_RE = /^(?:none\.?|n\/a|na|resident|resident\(s\)|trainee|attending|fellow|faculty|note|nr|not\s+present|available|dr\.?|doctor|prof\.?)$/i;
const SUFFIX_RE = /(?:,\s*|\s+)(?:MD|DO|PhD|RN|PA-C|PA|NP|MBBS|FRCR|FRCPC|MSK\s+Radiology\s+Fellow|Radiology\s+Fellow|Fellow|PGY\s*[\d\/\-]+)\.?(?:\s*,.*)?$/i;
const PREFIX_RE = /^(?:Dr\.?|Doctor|Prof\.?|Professor|Mr\.?|Mrs\.?|Ms\.?)\s+/i;
const PAREN_RE  = /\([^)]*\)/g;
const DISCLAIMER_RE   = /[,.]?\s*(?:not\s+present|but\s+readily|available\s+for|for\s+the\s+procedure|readily\s+available).*/gi;
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

// ─── Field splitting ──────────────────────────────────────────────────────────

function getPersonnelFields(text) {
  if (!text) return [];
  const idx = text.search(/Procedural\s+Personnel/i);
  if (idx === -1) return [];
  const raw = text.slice(idx).split(/\n\s*\n/)[0];
  return raw.split(/[ \t]{2,}|\r?\n/).map(s => s.trim()).filter(Boolean);
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
        // If the word after the comma is a known last name, these are two
        // different people (e.g. "Jung, Diop") → split.
        // Otherwise treat as Last, First (e.g. "Cheung, Stephanie") → join.
        if (knownLastNames && knownLastNames.has(after.toLowerCase())) return '|';
        return ' ';
      }
      return '|';
    });
  return s.split('|').map(p => p.replace(/[.,]+$/,'').trim()).filter(Boolean);
}

// ─── EPA-aware pair parsing (names only — scores go to extract_epa.js) ────────

function parseNameEpaPairs(content, knownLastNames) {
  content = content.replace(/\band\s+/gi,'|');
  content = content.replace(/\bTrainee\s*:\s*([1-5]|NR)\b/gi,'EPA: $1');
  const EPA_RE = /\b(?:Trainee\s+)?EPA\s*[:#]?\s*([1-5NR]?(?:\s*[,;\/&]\s*[1-5])*)/gi;
  const anchors = [];
  let m;
  while ((m = EPA_RE.exec(content)) !== null) {
    const scoreStr = (m[1]||'').trim().toUpperCase();
    const scores = [];
    if (scoreStr && scoreStr !== 'NR')
      for (const dm of scoreStr.matchAll(/\b([1-5])\b/g)) scores.push(parseInt(dm[1],10));
    anchors.push({ index: m.index, end: m.index + m[0].length, scores });
  }
  if (!anchors.length) return splitNamesLoose(content, knownLastNames).map(n=>({name:n,epas:[]}));
  const pairs = [];
  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i], prevEnd = i===0 ? 0 : anchors[i-1].end;
    let namePart = content.slice(prevEnd, anchor.index).trim().replace(/\s*Trainee\s*$/i,'').trim();
    const parts = splitNamesLoose(namePart, knownLastNames);
    if (!parts.length) continue;
    for (let j = 0; j < parts.length-1; j++) pairs.push({name:parts[j],epas:[]});
    pairs.push({name:parts[parts.length-1],epas:anchor.scores});
  }
  const afterLast = content.slice(anchors[anchors.length-1].end).trim();
  for (const n of splitNamesLoose(afterLast, knownLastNames)) pairs.push({name:n,epas:[]});
  return pairs;
}

// ─── Attending + trainee extraction ──────────────────────────────────────────

function extractAttendingNames(text, knownLastNames) {
  const fields = getPersonnelFields(text), names = [];
  for (const field of fields) {
    const m = field.match(/^Attending(?:\(s\))?(?:\s+physician(?:s)?)?\s*:\s*(.+)/i);
    if (!m) continue;
    const val = m[1].trim().replace(DISCLAIMER_RE,'').trim();
    for (const chunk of splitNamesLoose(val, knownLastNames)) {  // ← pass here too
      for (const name of (knownLastNames ? splitByKnownNames(chunk,knownLastNames) : [chunk])) {
        const c = cleanName(name);
        if (c && !names.includes(c)) names.push(c);
      }
    }
  }
  return names;
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

function extractTrainees(text, knownLastNames) {
  const fields = getPersonnelFields(text), results = [];
  const LABEL_RE = /^Resident(?:\(s\))?\s*(?:PGY\s*[\d\/\-]+\s*)?:\s*(.*)/i;
  let lastWasResident = false;
  for (let fi = 0; fi < fields.length; fi++) {
    const field = fields[fi];
    const andCont = field.match(/^and\s+(.+)/i);
    if (andCont && lastWasResident) {
      for (const {name,epas} of parseNameEpaPairs(andCont[1].trim(), knownLastNames)) {
        const c = cleanName(name); if (!c) continue;
        const ex = results.find(r=>r.name===c);
        if (ex) { for (const s of epas) ex.epas.add(s); } else results.push({name:c,epas:new Set(epas)});
      }
      continue;
    }
    const lm = field.match(LABEL_RE);
    if (!lm) { lastWasResident=false; continue; }
    lastWasResident = true;
    let content = lm[1].trim(); if (!content) continue;

    if (!content.match(/EPA/i)) {
      const next = fields[fi + 1] || '';
      const nextEpa = next.match(/^(?:Trainee\s+)?EPA\s*[:#]?\s*([1-5NR].*)/i);
      if (nextEpa) {
        content = content + '  Trainee EPA: ' + nextEpa[1].trim();
        fi++;
      }
    }

    for (const {name,epas} of parseNameEpaPairs(content, knownLastNames)) {
      const c = cleanName(name); if (!c) continue;
      const ex = results.find(r=>r.name===c);
      if (ex) { for (const s of epas) ex.epas.add(s); } else results.push({name:c,epas:new Set(epas)});
    }
  }
  return results.map(({name,epas})=>({name,epas:Array.from(epas).sort((a,b)=>a-b)}));
}

function enrichRow(r, knownLastNames) {
  return {
    ReportID:   r.ReportID,
    attendings: extractAttendingNames(r.ContentText, knownLastNames),
    trainees:   extractTrainees(r.ContentText, knownLastNames),
  };
}

// ─── User cache (users table + alias table) ───────────────────────────────────

async function buildUserCache(conn) {
  const cache = { attending: new Map(), trainee: new Map() };
  const ambiguous = new Set(), lastNames = new Set();

  function addKey(role, key, uid) {
    const k = key.trim().toLowerCase(); if (!k) return;
    const tag = `${role}:${k}`, rm = cache[role];
    if (ambiguous.has(tag)) return;
    if (rm.has(k) && rm.get(k) !== uid) { rm.delete(k); ambiguous.add(tag); }
    else rm.set(k, uid);
  }

  function index(uid, fn, ln, pn, role) {
    fn=(fn||'').trim(); ln=(ln||'').trim(); pn=(pn||'').trim();
    const fi=fn?fn[0]:'', pfi=pn?pn[0]:'';
    if (ln) lastNames.add(ln.toLowerCase());
    const variants=(first,last,ini)=>{
      if (first&&last) { addKey(role,`${first} ${last}`,uid); addKey(role,`${last} ${first}`,uid); addKey(role,`${last}, ${first}`,uid); }
      if (ini&&last) {
        addKey(role,`${ini}. ${last}`,uid); addKey(role,`${ini} ${last}`,uid);
        addKey(role,`${last} ${ini}.`,uid); addKey(role,`${last} ${ini}`,uid);
        addKey(role,`${last}, ${ini}.`,uid); addKey(role,`${last}, ${ini}`,uid);
      }
      if (first) addKey(role,first,uid);
      if (last)  addKey(role,last,uid);
    };
    variants(fn,ln,fi);
    if (pn&&pn.toLowerCase()!==fn.toLowerCase()) variants(pn,ln,pfi);
  }

  // 1. Index from users table
  const [users] = await conn.execute(
    'SELECT user_id, first_name, last_name, preferred_name, role FROM users'
  );
  for (const r of users) {
    const roles = (r.role==='attending'||r.role==='trainee') ? [r.role] : ['attending','trainee'];
    for (const role of roles) index(r.user_id,r.first_name,r.last_name,r.preferred_name,role);
  }

  // 2. Layer in manually confirmed aliases — these always win over ambiguous keys,
  //    but if the same alias maps to multiple user_ids, mark it ambiguous and skip it.
  try {
    const [aliases] = await conn.execute(
      'SELECT alias, role, user_id FROM user_name_aliases'
    );

    for (const a of aliases) {
      const rm = cache[a.role];
      if (!rm) continue;
      const k = a.alias.trim().toLowerCase();
      const tag = `${a.role}:${k}`;
      if (ambiguous.has(tag)) continue;
      if (rm.has(k) && rm.get(k) !== a.user_id) {
        rm.delete(k);
        ambiguous.add(tag);
        console.warn(`[WARN] Ambiguous alias skipped: "${k}" (role: ${a.role}) maps to multiple user_ids`);
      } else {
        rm.set(k, a.user_id);
      }
    }

    const ambiguousCount = [...ambiguous].filter(t => t.startsWith('attending:') || t.startsWith('trainee:')).length;
    console.log(`[INFO] User cache: ${cache.attending.size} attending keys, ${cache.trainee.size} trainee keys, ${users.length} users, ${aliases.length} aliases loaded, ${ambiguousCount} ambiguous aliases skipped.`);
  } catch (e) {
    console.warn('[WARN] Could not load user_name_aliases (run migration_aliases.sql):', e.message);
    console.log(`[INFO] User cache: ${cache.attending.size} attending keys, ${cache.trainee.size} trainee keys, ${users.length} users.`);
  }

  return { cache, lastNames };
}

function resolveUserId(raw, cache, role) {
  if (!raw) return null;
  const rm = cache[role]; if (!rm) return null;
  const seen = new Set();
  function tryKey(k) {
    k=(k||'').trim().toLowerCase(); if (!k||seen.has(k)) return null;
    seen.add(k); return rm.has(k)?rm.get(k):null;
  }
  let hit;
  if ((hit=tryKey(raw))!==null) return hit;
  const s=raw.replace(/[,\.]+$/,'').trim();
  if ((hit=tryKey(s))!==null) return hit;
  const cm=s.match(/^([^,]+),\s*(.+)$/);
  if (cm) {
    if ((hit=tryKey(`${cm[2]} ${cm[1]}`))!==null) return hit;
    if ((hit=tryKey(`${cm[1]} ${cm[2]}`))!==null) return hit;
  }
  const parts=s.split(/\s+/);
  if (parts.length===2&&(hit=tryKey(`${parts[1]} ${parts[0]}`))!==null) return hit;
  if (parts.length>=2) {
    const fi=parts[0][0],ln=parts[parts.length-1];
    if ((hit=tryKey(`${fi}. ${ln}`))!==null) return hit;
    if ((hit=tryKey(`${fi} ${ln}`))!==null) return hit;
  }
  return null;
}

// ─── DB writes ────────────────────────────────────────────────────────────────

async function upsertParticipant(conn, reportId, userId, role, sourceText, force) {
  if (force) {
    const [res] = await conn.execute(
      `INSERT INTO report_participants (report_id, user_id, role, source_text)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE user_id=VALUES(user_id), source_text=VALUES(source_text)`,
      [reportId, userId, role, sourceText]
    );
    if (res.insertId) return { id: res.insertId, status: 'inserted' };
  } else {
    const [res] = await conn.execute(
      `INSERT IGNORE INTO report_participants (report_id, user_id, role, source_text)
       VALUES (?, ?, ?, ?)`,
      [reportId, userId, role, sourceText]
    );
    if (res.insertId) return { id: res.insertId, status: 'inserted' };
  }
  const [rows] = await conn.execute(
    `SELECT id FROM report_participants WHERE report_id=? AND role=? AND user_id<=>? LIMIT 1`,
    [reportId, role, userId]
  );
  if (rows[0]?.id) return { id: rows[0].id, status: 'skipped' };
  return { id: null, status: 'miss' };
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchReports(conn, limit, reportId) {
  if (reportId) {
    const [rows] = await conn.execute(
      'SELECT ReportID, ContentText FROM reports WHERE ReportID=? AND ContentText IS NOT NULL',
      [reportId]
    );
    return rows;
  }
  if (limit > 0) {
    const [rows] = await conn.execute(
      `SELECT ReportID, ContentText FROM reports WHERE ContentText IS NOT NULL LIMIT ${Number(limit)}`
    );
    return rows;
  }
  const [rows] = await conn.execute(
    'SELECT ReportID, ContentText FROM reports WHERE ContentText IS NOT NULL'
  );
  return rows;
}

// ─── Summary ──────────────────────────────────────────────────────────────────

function computeStats(enriched, cache) {
  let reportsWithPersonnel=0,reportsWithAttending=0,reportsWithTrainee=0,reportsWithEpa=0,resolvedEpas=0;
  let totalAttending=0,totalTrainees=0,totalEpas=0,resolvedAttending=0,resolvedTrainees=0;
  const unresolved=[], dbKeysSeen=new Set();
  for (const r of enriched) {
    if (!r.attendings.length&&!r.trainees.length) continue;
    reportsWithPersonnel++;
    if (r.attendings.length) reportsWithAttending++;
    if (r.trainees.length)   reportsWithTrainee++;
    if (r.trainees.some(t=>t.epas.length)) reportsWithEpa++;
    for (const name of r.attendings) {
      totalAttending++;
      const uid=resolveUserId(name,cache,'attending');
      if (uid!==null) { const k=`${r.ReportID}|${uid}|attending`; if(!dbKeysSeen.has(k)){dbKeysSeen.add(k);resolvedAttending++;} }
      else unresolved.push({ReportID:r.ReportID,role:'attending',name});
    }
    for (const {name,epas} of r.trainees) {
      totalTrainees++; totalEpas+=epas.length;
      const uid=resolveUserId(name,cache,'trainee');
      if (uid!==null) {
        const k=`${r.ReportID}|${uid}|trainee`;
        if(!dbKeysSeen.has(k)){dbKeysSeen.add(k);resolvedTrainees++;}
        resolvedEpas+=epas.length;   // ← add this
      }
      else unresolved.push({ReportID:r.ReportID,role:'trainee',name});
    }
  }
  return {reportsWithPersonnel,reportsWithAttending,reportsWithTrainee,reportsWithEpa,
          totalAttending,totalTrainees,totalEpas,resolvedAttending,resolvedTrainees,unresolved,
          totalEpas, resolvedEpas, unresolved};
}

function printSummary(enriched, cache, writeStats) {
  const s=computeStats(enriched,cache), W=72;
  const LINE='═'.repeat(W), DASH='─'.repeat(W);
  const pct=(n,d)=>d?`${((n/d)*100).toFixed(1)}%`:'n/a';
  const row=(label,value)=>console.log(`  ${label.padEnd(38)} : ${value}`);
  if (s.unresolved.length) {
    console.log('\n'+DASH);
    console.log('  Unresolved names (will appear in unmatched_people.csv):');
    for (const u of s.unresolved)
      console.log(`    [${u.role.padEnd(9)}] "${u.name}"  (ReportID: ${u.ReportID})`);
    console.log('\n  Run manual_resolve.js output/unmatched_people.csv to fix these.');
  }
  console.log('\n'+LINE); console.log('  SUMMARY'); console.log(LINE);
  row('Reports processed',enriched.length);
  row('Reports with personnel',`${s.reportsWithPersonnel}  (${pct(s.reportsWithPersonnel,enriched.length)})`);
  row('Reports with no personnel',enriched.length-s.reportsWithPersonnel);
  console.log(DASH);
  row('Reports with attending',s.reportsWithAttending);
  row('Reports with trainee',s.reportsWithTrainee);
  row('Reports with EPA score',s.reportsWithEpa);
  console.log(DASH);
  row('Total attending slots',s.totalAttending);
  row('  Resolved to user_id',`${s.resolvedAttending}  (${pct(s.resolvedAttending,s.totalAttending)})`);
  row('  Unresolved (skipped)',s.totalAttending-s.resolvedAttending);
  row('Total trainee slots',s.totalTrainees);
  row('  Resolved to user_id',`${s.resolvedTrainees}  (${pct(s.resolvedTrainees,s.totalTrainees)})`);
  row('  Unresolved (skipped)',s.totalTrainees-s.resolvedTrainees);
  row('Total EPA slots',s.totalEpas);
  row('  Resolved (trainee matched)',`${s.resolvedEpas}  (${pct(s.resolvedEpas,s.totalEpas)})`);
  row('  Unresolved (trainee unmatched)',s.totalEpas-s.resolvedEpas);
  if (writeStats) {
    console.log(DASH);
    row('Participant rows written',writeStats.totalParticipants);
    if (writeStats.errors) row('Errors',writeStats.errors);
  }
  console.log(LINE+'\n');
}

function printDryRun(enriched, cache) {
  console.log('\n'+'═'.repeat(72));
  console.log('  DRY-RUN — extracted personnel'); console.log('═'.repeat(72));
  for (const r of enriched) {
    if (!r.attendings.length&&!r.trainees.length) continue;
    console.log(`\n  ReportID: ${r.ReportID}`);
    for (const name of r.attendings) {
      const uid=resolveUserId(name,cache,'attending');
      console.log(`    [attending] "${name}"  →  ${uid!==null?`user_id=${uid}`:'NO MATCH'}`);
    }
    for (const {name,epas} of r.trainees) {
      const uid=resolveUserId(name,cache,'trainee');
      const epaStr=epas.length?epas.join(', '):'none (see extract_epa.js)';
      console.log(`    [trainee]   "${name}"  →  ${uid!==null?`user_id=${uid}`:'NO MATCH'}  |  EPA tokens: [${epaStr}]`);
    }
  }
  printSummary(enriched,cache,null);
  console.log('  No data was written. Run with --write to commit.\n');
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

  const rows = await fetchReports(conn, argv['report-id']?0:argv.limit, argv['report-id']);
  if (!rows.length) { console.log('[INFO] No reports found.'); await conn.end(); return; }
  console.log(`[INFO] Processing ${rows.length} report(s)…`);

  const {cache,lastNames} = await buildUserCache(conn);
  const enriched = rows.map(r=>enrichRow(r,lastNames));

  if (argv['dry-run']) { printDryRun(enriched,cache); await conn.end(); return; }

  // ── Write ──────────────────────────────────────────────────────────────────
  const unmatchedPeople=[], unmatchedEpas=[];
  let totalParticipants=0, errors=0, dbInserted=0, dbSkipped=0, dbMiss=0;
  const PROGRESS=100;

  for (let i=0; i<enriched.length; i++) {
    const r=enriched[i];
    await conn.beginTransaction();
    try {
      for (const name of r.attendings) {
        const uid=resolveUserId(name,cache,'attending');
        if (!uid) { unmatchedPeople.push({reportId:r.ReportID,role:'attending',name}); continue; }
        const res=await upsertParticipant(conn,r.ReportID,uid,'attending',name,argv.force);
        if (res.status==='inserted'){totalParticipants++;dbInserted++;}
        else if (res.status==='skipped') dbSkipped++;
        else { dbMiss++; console.error(`\n[MISS] attending "${name}" uid=${uid} report=${r.ReportID}`); }
      }
      for (const {name,epas} of r.trainees) {
        const uid=resolveUserId(name,cache,'trainee');
        if (!uid) {
          unmatchedPeople.push({reportId:r.ReportID,role:'trainee',name});
          if (epas.length) unmatchedEpas.push({reportId:r.ReportID,trainee:name,epas});
          continue;
        }
        const res=await upsertParticipant(conn,r.ReportID,uid,'trainee',name,argv.force);
        if (res.status==='inserted'){totalParticipants++;dbInserted++;}
        else if (res.status==='skipped') dbSkipped++;
        else { dbMiss++; console.error(`\n[MISS] trainee "${name}" uid=${uid} report=${r.ReportID}`); }
      }
      await conn.commit();
    } catch(e) {
      await conn.rollback(); errors++;
      console.error(`\n[ERROR] ReportID ${r.ReportID}: ${e.message}`);
    }
    if ((i+1)%PROGRESS===0||i+1===enriched.length)
      process.stdout.write(`  ${i+1}/${enriched.length} — participants: ${totalParticipants}  errors: ${errors}\r`);
  }

  await conn.end();
  console.log('');
  console.log(`[DB] Inserted: ${dbInserted}  Skipped: ${dbSkipped}  Miss: ${dbMiss}`);
  printSummary(enriched,cache,{totalParticipants,errors});

  // Only write names that are not already in the alias table
  // (aliases were loaded into the cache, so anything still unresolved is genuinely new)
  writeCSV(path.join(OUTPUT_DIR,'unmatched_people.csv'), unmatchedPeople, ['reportId','role','name']);
  writeCSV(
    path.join(OUTPUT_DIR,'unmatched_epas.csv'),
    unmatchedEpas.map(r=>({reportId:r.reportId,trainee:r.trainee,epas:r.epas.join('|')})),
    ['reportId','trainee','epas']
  );
  console.log(`[INFO] unmatched_people.csv: ${unmatchedPeople.length} rows`);
  console.log(`[INFO] unmatched_epas.csv:   ${unmatchedEpas.length} rows`);
  console.log(`[INFO] Next: node scripts/manual_resolve.js output/unmatched_people.csv`);
}

if (require.main===module) main().catch(err=>{console.error('\n[FATAL]',err.message);process.exit(1);});