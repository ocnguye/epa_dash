import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';

const getConnection = async () => mysql.createConnection({
  host: process.env.AWS_RDS_HOST,
  user: process.env.AWS_RDS_USER,
  password: process.env.AWS_RDS_PWD || process.env.AWS_RDS_PASS,
  database: process.env.AWS_RDS_DB || 'powerscribe',
});

// Returns time-series counts for the current residency (based on logged-in user's pgy).
// Query params:
// - range=week|month (defaults to week)
// - score=1..4 optional filter used to compute disagree_count (defaults to 4)
export async function GET(req: NextRequest) {
  try {
    const username = req.cookies.get('username')?.value;
    if (!username) return NextResponse.json({ success: false, message: 'Not authenticated' }, { status: 401 });

  const range = (req.nextUrl.searchParams.get('range') || 'week').toLowerCase();
  const scoreParam = req.nextUrl.searchParams.get('score');
  const monthParam = req.nextUrl.searchParams.get('month'); // format YYYY-MM
    const score = scoreParam ? parseInt(scoreParam, 10) : 4;
    if (scoreParam && (Number.isNaN(score) || score < 1 || score > 4)) {
      return NextResponse.json({ success: false, message: 'Invalid score parameter' }, { status: 400 });
    }

    const conn = await getConnection();

    // Residency is fixed to PGY6 per requirement
    const myPgy = 6;

    // Define date range and grouping.
    // If monthParam is provided (YYYY-MM), we will aggregate by date across that month.
  let startDateSql = '';
  let groupByExpr = "DATE(r.EXAM_FINAL_DATE)";
  let labelExpr = "DATE_FORMAT(DATE(r.EXAM_FINAL_DATE), '%Y-%m-%d')";
  let days = 7; // default
  let startDateLiteral = '';
  let monthStartDate: Date | null = null;
  let monthEndDate: Date | null = null;
    if (monthParam) {
      // Expect format YYYY-MM
      const m = monthParam.match(/^(\d{4})-(\d{2})$/);
      if (!m) {
        await conn.end();
        return NextResponse.json({ success: false, message: 'Invalid month parameter; expected YYYY-MM' }, { status: 400 });
      }
      const year = Number(m[1]);
      const mon = Number(m[2]);
      if (mon < 1 || mon > 12) {
        await conn.end();
        return NextResponse.json({ success: false, message: 'Invalid month parameter; month out of range' }, { status: 400 });
      }
  const startDate = new Date(year, mon - 1, 1);
  const endDate = new Date(year, mon, 0); // last day of month
  days = endDate.getDate();
  monthStartDate = startDate;
  monthEndDate = endDate;
      const yyyy = startDate.getFullYear();
      const mm = String(startDate.getMonth() + 1).padStart(2, '0');
      const dd = String(startDate.getDate()).padStart(2, '0');
      const yyyy2 = endDate.getFullYear();
      const mm2 = String(endDate.getMonth() + 1).padStart(2, '0');
      const dd2 = String(endDate.getDate()).padStart(2, '0');
      startDateSql = `DATE('${yyyy}-${mm}-${dd}')`;
  startDateLiteral = `AND DATE(r.EXAM_FINAL_DATE) BETWEEN '${yyyy}-${mm}-${dd}' AND '${yyyy2}-${mm2}-${dd2}'`;
    } else if (range === 'month') {
      // last 30 days grouped by date
      startDateSql = "DATE_SUB(CURDATE(), INTERVAL 29 DAY)";
      days = 30;
    } else {
      // default: week -> last 7 days grouped by date
      startDateSql = "DATE_SUB(CURDATE(), INTERVAL 6 DAY)";
      days = 7;
    }

    // condition for disagree_count matching the provided score
    const rprCond = `(r.rpr_number_value = ${score} OR UPPER(COALESCE(r.rpr_number_raw, '')) REGEXP 'RPR[[:space:]]*${score}|RPR${score}|RPR-${score}')`;

    // We only include reports where the trainee is linked to a user with the same pgy
    // Build SQL depending on whether a specific month window was requested
    let sql = '';
    if (monthParam) {
      sql = `
      SELECT
        ${labelExpr} AS label,
        ${groupByExpr} AS grp,
        COUNT(*) AS total_reports,
        SUM(CASE WHEN ${rprCond} THEN 1 ELSE 0 END) AS disagree_count
      FROM rpr_reports r
      JOIN users u ON r.trainee_id = u.user_id
      WHERE u.pgy = ?
        ${startDateLiteral}
      GROUP BY grp
      ORDER BY grp ASC
      `;
    } else {
      sql = `
      SELECT
        ${labelExpr} AS label,
        ${groupByExpr} AS grp,
        COUNT(*) AS total_reports,
        SUM(CASE WHEN ${rprCond} THEN 1 ELSE 0 END) AS disagree_count
      FROM rpr_reports r
      JOIN users u ON r.trainee_id = u.user_id
      WHERE u.pgy = ?
  AND DATE(r.EXAM_FINAL_DATE) >= ${startDateSql}
      GROUP BY grp
      ORDER BY grp ASC
      `;
    }

    const [rows] = await conn.execute(sql, [myPgy]) as [any[], any];

    // Build a map of date->{counts} and fill missing dates across the window with zeros
    const resultsMap: Record<string, any> = {};
    for (const r of rows) {
      const label = r.label;
      resultsMap[label] = {
        label,
        total_reports: Number(r.total_reports) || 0,
        disagree_count: Number(r.disagree_count) || 0,
      };
    }

    // compute window labels
    const out: any[] = [];
    let start: Date;
    if (monthStartDate) {
      start = new Date(monthStartDate.getFullYear(), monthStartDate.getMonth(), monthStartDate.getDate());
    } else {
      const now = new Date();
      // build start date as midnight local of (days-1) ago
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      start.setDate(start.getDate() - (days - 1));
    }
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const label = `${yyyy}-${mm}-${dd}`;
      const row = resultsMap[label] || { label, total_reports: 0, disagree_count: 0 };
      row.disagree_percent = row.total_reports > 0 ? +(row.disagree_count / row.total_reports * 100).toFixed(2) : 0;
      out.push(row);
    }

    await conn.end();
    return NextResponse.json({ success: true, data: out });
  } catch (err) {
    return NextResponse.json({ success: false, message: 'Server error', error: (err as Error).message }, { status: 500 });
  }
}
