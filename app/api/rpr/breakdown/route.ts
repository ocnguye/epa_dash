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

    // parse score param (optional). Accept 1-4 or absent
    const scoreParam = req.nextUrl.searchParams.get('score');
    const score = scoreParam ? parseInt(scoreParam, 10) : null;
    if (score !== null && (Number.isNaN(score) || score < 1 || score > 4)) {
      await connection.end();
      return NextResponse.json({ success: false, message: 'Invalid score parameter; must be 1,2,3 or 4' }, { status: 400 });
    }

    // Find the logged-in user so we can filter rpr_reports for that trainee
    const [userRows] = await connection.execute(
      `SELECT user_id, first_name, last_name FROM users WHERE username = ? LIMIT 1`,
      [username]
    );
    if (!Array.isArray(userRows) || (userRows as any).length === 0) {
      await connection.end();
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
    }
    const rawUser = (userRows as any)[0];
    const userId = Number(rawUser.user_id);
    const firstName = rawUser.first_name || '';
    const lastName = rawUser.last_name || '';

    // groupBy param: modality | procedure_name | patient_class
    const gb = (req.nextUrl.searchParams.get('groupBy') || '').toLowerCase();
    let column = 'ProcedureName';
    if (gb === 'modality' || gb === 'mod') column = 'Modality';
    else if (gb === 'patientclass' || gb === 'patient_class' || gb === 'patient') column = 'PatientClass';

    const hasRprCond = `(r.rpr_number_value IS NOT NULL OR (r.rpr_number_raw IS NOT NULL AND TRIM(r.rpr_number_raw) <> ''))`;
    const rprCond = score === null ? '0=1' : `(r.rpr_number_value = ${score} OR UPPER(COALESCE(r.rpr_number_raw, '')) REGEXP 'RPR[[:space:]]*${score}|RPR${score}|RPR-${score}')`;

    // If score is null, we will only return totals (disagree_count = 0) but still group totals
    // Filter to reports relevant to the logged-in trainee (match by trainee_id, username, or FIRST_RESIDENT)
    const query = `
      SELECT
        COALESCE(r.${column}, 'Unspecified') AS grp,
        COUNT(*) AS total_with_rpr,
        SUM(CASE WHEN ${rprCond} THEN 1 ELSE 0 END) AS disagree_count
      FROM rpr_reports r
      WHERE ${hasRprCond}
        AND (
          r.trainee_id = ?
          OR r.trainee_id = CONCAT(?, ' ', ?)
          OR r.trainee_id = ?
          OR r.FIRST_RESIDENT = CONCAT(?, ' ', ?)
        )
      GROUP BY grp
      ORDER BY total_with_rpr DESC
      LIMIT 100`;

    const params: any[] = [userId, firstName, lastName, username, firstName, lastName];
    const [rows] = await connection.execute(query, params);
    await connection.end();

    const groups = (rows as any[]).map(r => {
      const total = Number(r.total_with_rpr) || 0;
      const disagree = Number(r.disagree_count) || 0;
      return {
        group: r.grp,
        total_with_rpr: total,
        disagree_count: disagree,
        disagree_percent: total > 0 ? Number(((disagree / total) * 100).toFixed(2)) : 0,
      };
    });

    return NextResponse.json({ success: true, data: { groups } });
  } catch (err) {
    console.error('RPR breakdown error', err);
    return NextResponse.json({ success: false, message: 'Server error', error: (err as Error).message }, { status: 500 });
  }
}
