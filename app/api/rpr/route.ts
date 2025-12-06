import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';

export async function GET(req: NextRequest) {
  try {
    const connection = await mysql.createConnection({
      host: process.env.AWS_RDS_HOST,
      user: process.env.AWS_RDS_USER,
      password: process.env.AWS_RDS_PWD || process.env.AWS_RDS_PASS,
      database: process.env.AWS_RDS_DB || 'powerscribe',
    });

    // Simple read of recent RPR reports with optional join to users if ids present
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
       ORDER BY r.CREATEDATE DESC
       LIMIT 500`);

    await connection.end();
    return NextResponse.json({ success: true, data: rows });
  } catch (err) {
    console.error('RPR API error', err);
    return NextResponse.json({ success: false, message: 'Server error', error: (err as Error).message }, { status: 500 });
  }
}
