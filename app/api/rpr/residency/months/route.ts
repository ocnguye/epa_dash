import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';

const getConnection = async () => mysql.createConnection({
  host: process.env.AWS_RDS_HOST,
  user: process.env.AWS_RDS_USER,
  password: process.env.AWS_RDS_PWD || process.env.AWS_RDS_PASS,
  database: process.env.AWS_RDS_DB || 'powerscribe',
});

export async function GET(req: NextRequest) {
  try {
    const username = req.cookies.get('username')?.value;
    if (!username) return NextResponse.json({ success: false, message: 'Not authenticated' }, { status: 401 });

    const conn = await getConnection();
    // fixed residency PGY per requirement
    const myPgy = 6;

    // Find distinct months (YYYY-MM) that have reports for this residency
    const sql = `
      SELECT DATE_FORMAT(DATE(r.EXAM_FINAL_DATE), '%Y-%m') AS mon, COUNT(*) AS cnt
      FROM rpr_reports r
      JOIN users u ON r.trainee_id = u.user_id
      WHERE u.pgy = ?
      GROUP BY mon
      ORDER BY mon DESC
    `;

    const [rows] = await conn.execute(sql, [myPgy]) as [any[], any];
    await conn.end();

    const months = (rows || []).map((r: any) => r.mon).filter(Boolean);
    return NextResponse.json({ success: true, data: months });
  } catch (err) {
    return NextResponse.json({ success: false, message: 'Server error', error: (err as Error).message }, { status: 500 });
  }
}
