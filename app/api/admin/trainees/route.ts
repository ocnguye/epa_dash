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

        const connection = await getConnection();

        // verify requester role
        const [authRows] = await connection.execute('SELECT role, user_id FROM users WHERE username = ?', [username]);
        const auth = Array.isArray(authRows) && authRows[0] ? (authRows as any)[0] : null;
        if (!auth) {
            await connection.end();
            return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
        }
        if (String(auth.role) !== 'attending') {
            await connection.end();
            return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
        }

        // Return list of trainees with basic EPA summary
        // Join reports to compute average EPA per trainee (coerce numeric values)
        const [rows] = await connection.execute(
            `SELECT
                u.user_id,
                u.username,
                u.first_name,
                u.last_name,
                u.preferred_name,
                u.pgy,
                u.role,
                COALESCE(ROUND(AVG(CASE WHEN r.epa REGEXP '^[0-9]+(\\.[0-9]+)?$' THEN CAST(r.epa AS DECIMAL(5,2)) END),2),0) AS avg_epa,
                COUNT(r.ReportID) AS report_count
             FROM users u
             LEFT JOIN reports r ON (
                r.trainee = u.user_id
                OR r.trainee = CONCAT(u.first_name, ' ', u.last_name)
                OR r.trainee = u.username
             )
             WHERE u.role != 'attending'
             GROUP BY u.user_id
             ORDER BY avg_epa DESC, u.pgy DESC`);

        await connection.end();

        return NextResponse.json({ success: true, trainees: rows });
    } catch (err) {
        return NextResponse.json({ success: false, message: 'Server error', error: (err as Error).message }, { status: 500 });
    }
}
