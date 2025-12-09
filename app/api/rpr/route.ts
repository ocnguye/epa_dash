import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';

export async function GET(req: NextRequest) {
  try {
    const username = req.cookies.get('username')?.value;
    if (!username) {
      return NextResponse.json({ success: false, message: 'Not authenticated' }, { status: 401 });
    }

    const connection = await mysql.createConnection({
      host: process.env.AWS_RDS_HOST,
      user: process.env.AWS_RDS_USER,
      password: process.env.AWS_RDS_PWD || process.env.AWS_RDS_PASS,
      database: process.env.AWS_RDS_DB || 'powerscribe',
    });

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

    // Optional score filter (1-4) for returned reports. Defaults to 4 if not supplied.
    const scoreParam = req.nextUrl.searchParams.get('score');
    const score = scoreParam ? parseInt(scoreParam, 10) : null;
    if (score !== null && (Number.isNaN(score) || score < 1 || score > 4)) {
      await connection.end();
      return NextResponse.json({ success: false, message: 'Invalid score parameter; must be 1,2,3 or 4' }, { status: 400 });
    }

    // Return recent RPR reports only for this trainee (flexible matching similar to other APIs)
    let scoreFilter = '';
    if (score !== null) {
      scoreFilter = ` AND (r.rpr_number_value = ${score} OR UPPER(COALESCE(r.rpr_number_raw, '')) REGEXP 'RPR[[:space:]]*${score}|RPR${score}|RPR-${score}')`;
    }

    const [rows] = await connection.execute(
      `SELECT
         r.Accession AS accession,
         r.Modality AS modality,
         r.ProcedureName AS procedure_name,
         r.PatientClass AS patient_class,
         r.FEEDBACK AS feedback,
         r.FIRST_RESIDENT AS first_resident,
         r.SIGNING_MD AS signing_md,
         r.CREATEDATE AS createdate,
         r.FinalReport AS final_report,
         r.rpr_number_raw AS rpr_number_raw,
         r.rpr_number_value AS rpr_number_value,
         r.trainee_id AS trainee_id_raw,
         r.attending_id AS attending_id_raw,
         u1.user_id AS trainee_user_id,
         CONCAT(u1.first_name, ' ', u1.last_name) AS trainee_name,
         u2.user_id AS attending_user_id,
         CONCAT(u2.first_name, ' ', u2.last_name) AS attending_name
       FROM rpr_reports r
       LEFT JOIN users u1 ON r.trainee_id = u1.user_id
       LEFT JOIN users u2 ON r.attending_id = u2.user_id
       WHERE (
         r.trainee_id = ?
         OR r.trainee_id = CONCAT(?, ' ', ?)
         OR r.trainee_id = ?
         OR r.FIRST_RESIDENT = CONCAT(?, ' ', ?)
       ) ${scoreFilter}
       ORDER BY r.CREATEDATE DESC`,
      [userId, firstName, lastName, username, firstName, lastName]
    );

    await connection.end();
    return NextResponse.json({ success: true, data: rows });
  } catch (err) {
    console.error('RPR API error', err);
    return NextResponse.json({ success: false, message: 'Server error', error: (err as Error).message }, { status: 500 });
  }
}
