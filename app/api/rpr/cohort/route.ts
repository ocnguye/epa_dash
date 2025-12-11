import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';

export async function GET(req: NextRequest) {
  try {
    const username = req.cookies.get('username')?.value;
    if (!username) return NextResponse.json({ success: false, message: 'Not authenticated' }, { status: 401 });

    const connection = await mysql.createConnection({
      host: process.env.AWS_RDS_HOST,
      user: process.env.AWS_RDS_USER,
      password: process.env.AWS_RDS_PWD || process.env.AWS_RDS_PASS,
      database: process.env.AWS_RDS_DB || 'powerscribe',
    });

    // find current user id and pgy
    const [urows] = await connection.execute(`SELECT user_id, pgy FROM users WHERE username = ? LIMIT 1`, [username]);
    if (!Array.isArray(urows) || (urows as any).length === 0) {
      await connection.end();
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
    }
  const me = (urows as any)[0];
  const meId = Number(me.user_id);
  const myPgy = typeof me.pgy !== 'undefined' && me.pgy !== null ? Number(me.pgy) : null;

    // Parse optional score query param (1-4). Default to 4 for backward compatibility.
    const scoreParam = req.nextUrl.searchParams.get('score');
    const score = scoreParam ? parseInt(scoreParam, 10) : 4;
    if (Number.isNaN(score) || score < 1 || score > 4) {
      await connection.end();
      return NextResponse.json({ success: false, message: 'Invalid score parameter; must be 1,2,3 or 4' }, { status: 400 });
    }

    // Conditions
    const hasRprCond = `(r.rpr_number_value IS NOT NULL OR (r.rpr_number_raw IS NOT NULL AND TRIM(r.rpr_number_raw) <> ''))`;
    const rprCond = `(r.rpr_number_value = ${score} OR UPPER(COALESCE(r.rpr_number_raw, '')) REGEXP 'RPR[[:space:]]*${score}|RPR${score}|RPR-${score}')`;

    // Optional month filter (YYYY-MM) to limit counts to a specific month
    const monthParam = req.nextUrl.searchParams.get('month');
    let monthStartLiteral = '';
    let monthParams: any[] = [];
    if (monthParam) {
      const m = monthParam.match(/^(\d{4})-(\d{2})$/);
      if (!m) {
        return NextResponse.json({ success: false, message: 'Invalid month parameter; expected YYYY-MM' }, { status: 400 });
      }
      const year = Number(m[1]);
      const mon = Number(m[2]);
      if (mon < 1 || mon > 12) {
        return NextResponse.json({ success: false, message: 'Invalid month parameter; month out of range' }, { status: 400 });
      }
      const startDate = `${year}-${String(mon).padStart(2, '0')}-01`;
      const endDate = new Date(year, mon, 0);
      const endDateStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
      monthStartLiteral = ` AND DATE(r.EXAM_FINAL_DATE) BETWEEN ? AND ?`;
      monthParams = [startDate, endDateStr];
    }

    // Per-trainee aggregation (only include reports linked to users via trainee_id)
    const perSql = `SELECT u.user_id AS uid, u.pgy AS pgy,
        COUNT(*) AS total_with_rpr,
  SUM(CASE WHEN ${rprCond} THEN 1 ELSE 0 END) AS disagree_count
       FROM rpr_reports r
       JOIN users u ON r.trainee_id = u.user_id
       WHERE ${hasRprCond} ${monthStartLiteral}
       GROUP BY u.user_id, u.pgy
       HAVING total_with_rpr > 0
       ORDER BY disagree_count DESC`;
    const perParams = monthParams;
    const [perRows] = await connection.execute(perSql, perParams);

    // Compute cohort (PGY6) and overall averages
    let cohortRows: any = [{ disagree_count: 0, total_with_rpr: 0 }];
    if (myPgy !== null) {
      const cohortSql = `SELECT
           SUM(CASE WHEN ${rprCond} THEN 1 ELSE 0 END) AS disagree_count,
           COUNT(*) AS total_with_rpr
         FROM rpr_reports r
         JOIN users u ON r.trainee_id = u.user_id
         WHERE ${hasRprCond} AND u.pgy = ? ${monthStartLiteral}`;
      const cohortParams = monthParams.length ? [myPgy, ...monthParams] : [myPgy];
      const [cRows] = await connection.execute(cohortSql, cohortParams);
      cohortRows = cRows as any;
    }

    // overall should include all reports with RPR (including those without trainee_id)
    const overallSql = `SELECT
         SUM(CASE WHEN ${rprCond} THEN 1 ELSE 0 END) AS disagree_count,
         COUNT(*) AS total_with_rpr
       FROM rpr_reports r
       WHERE ${hasRprCond} ${monthStartLiteral}`;
    const overallParams = monthParams;
    const [overallRows] = await connection.execute(overallSql, overallParams);

    await connection.end();

    const per = (perRows as any[]) || [];
    const cohort = ((cohortRows as any[])[0]) || { disagree_count: 0, total_with_rpr: 0 };
    const overall = ((overallRows as any[])[0]) || { disagree_count: 0, total_with_rpr: 0 };

    const trainees = per.map((r, idx) => {
      const total = Number(r.total_with_rpr) || 0;
      const disagree = Number(r.disagree_count) || 0;
      const pct = total > 0 ? (disagree / total) * 100 : 0;
      return {
        // do not include name or username
        is_current: Number(r.uid) === meId,
        pgy: r.pgy !== null ? Number(r.pgy) : null,
        total_with_rpr: total,
        disagree_count: disagree,
        // provide up to 2 decimal places for granularity
        disagree_percent: Number(pct.toFixed(2)),
      };
    });

    const cohort_percent = (Number(cohort.total_with_rpr) || 0) > 0 ? Number(((Number(cohort.disagree_count) || 0) / Number(cohort.total_with_rpr) * 100).toFixed(2)) : 0;
    const overall_percent = (Number(overall.total_with_rpr) || 0) > 0 ? Number(((Number(overall.disagree_count) || 0) / Number(overall.total_with_rpr) * 100).toFixed(2)) : 0;

    return NextResponse.json({ success: true, data: { cohort_percent, overall_percent, trainees } });
  } catch (err) {
    console.error('RPR cohort error', err);
    return NextResponse.json({ success: false, message: 'Server error', error: (err as Error).message }, { status: 500 });
  }
}
