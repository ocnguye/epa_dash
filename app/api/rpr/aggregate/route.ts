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

    // find user id
    const [urows] = await connection.execute(`SELECT user_id, first_name, last_name FROM users WHERE username = ? LIMIT 1`, [username]);
    if (!Array.isArray(urows) || (urows as any).length === 0) {
      await connection.end();
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
    }
    const user = (urows as any)[0];
    const userId = Number(user.user_id);
    const firstName = user.first_name || '';
    const lastName = user.last_name || '';

    // Parse optional score query param (1-4). Default to 4 for backward compatibility.
    const scoreParam = req.nextUrl.searchParams.get('score');
    const score = scoreParam ? parseInt(scoreParam, 10) : 4;
    if (Number.isNaN(score) || score < 1 || score > 4) {
      await connection.end();
      return NextResponse.json({ success: false, message: 'Invalid score parameter; must be 1,2,3 or 4' }, { status: 400 });
    }

    // define condition for "has RPR data"
    const hasRprCond = `(r.rpr_number_value IS NOT NULL OR (r.rpr_number_raw IS NOT NULL AND TRIM(r.rpr_number_raw) <> ''))`;
    // dynamic RPR condition for the requested score
    const rprCond = `(r.rpr_number_value = ${score} OR UPPER(COALESCE(r.rpr_number_raw, '')) REGEXP 'RPR[[:space:]]*${score}|RPR${score}|RPR-${score}')`;

    // Trainee counts: restrict to reports that have extracted RPR data, then count/aggregate
    const [tRows] = await connection.execute(
      `SELECT
         COUNT(*) AS total_with_rpr,
         SUM(CASE WHEN ${rprCond} THEN 1 ELSE 0 END) AS disagree_count
       FROM rpr_reports r
       WHERE (
         r.trainee_id = ?
         OR r.trainee_id = CONCAT(?, ' ', ?)
         OR r.trainee_id = ?
         OR r.FIRST_RESIDENT = CONCAT(?, ' ', ?)
       )
       AND ${hasRprCond}
       `,
      [userId, firstName, lastName, username, firstName, lastName]
    );

    // Overall resident counts (all reports with RPR data)
    const [oRows] = await connection.execute(
      `SELECT
         SUM(CASE WHEN ${hasRprCond} THEN 1 ELSE 0 END) AS total_with_rpr,
         SUM(CASE WHEN ${rprCond} THEN 1 ELSE 0 END) AS disagree_count
       FROM rpr_reports r
       WHERE ${hasRprCond}
       `
    );

    await connection.end();

    const t = (tRows as any)[0] || { total_with_rpr: 0, disagree_count: 0 };
    const o = (oRows as any)[0] || { total_with_rpr: 0, disagree_count: 0 };

    const trainee = {
      total_with_rpr: Number(t.total_with_rpr) || 0,
      disagree_count: Number(t.disagree_count) || 0,
      disagree_percent: (Number(t.total_with_rpr) || 0) > 0 ? Number(((Number(t.disagree_count) || 0) / Number(t.total_with_rpr) * 100).toFixed(2)) : 0,
    };

    const overall = {
      total_with_rpr: Number(o.total_with_rpr) || 0,
      disagree_count: Number(o.disagree_count) || 0,
      disagree_percent: (Number(o.total_with_rpr) || 0) > 0 ? Number(((Number(o.disagree_count) || 0) / Number(o.total_with_rpr) * 100).toFixed(2)) : 0,
    };

    return NextResponse.json({ success: true, data: { trainee, overall } });
  } catch (err) {
    console.error('RPR aggregate error', err);
    return NextResponse.json({ success: false, message: 'Server error', error: (err as Error).message }, { status: 500 });
  }
}
