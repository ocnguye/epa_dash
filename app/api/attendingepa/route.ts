import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';

const getConnection = async () => mysql.createConnection({
    host: process.env.AWS_RDS_HOST,
    user: process.env.AWS_RDS_USER,
    password: process.env.AWS_RDS_PWD,
    database: process.env.AWS_RDS_DB || 'powerscribe',
});

export async function GET(req: NextRequest) {
    try {
        const username = req.cookies.get('username')?.value;
        if (!username) return NextResponse.json({ success: false, message: 'Not authenticated' }, { status: 401 });

        const connection = await getConnection();

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

        const [evaluatorRows] = await connection.execute(
            `SELECT
                COALESCE(ROUND(AVG(es.epa_score), 2), 0) AS evaluator_avg_epa,
                COUNT(DISTINCT rp_trainee.report_id) AS evaluator_report_count
            FROM report_participants rp_attending
            JOIN report_participants rp_trainee
                ON rp_trainee.report_id = rp_attending.report_id
                AND rp_trainee.role = 'trainee'
            JOIN epa_scores es
                ON es.report_participant_id = rp_trainee.id
            WHERE rp_attending.user_id = ?
            AND rp_attending.role = 'attending'`,
            [auth.user_id]
        );

        const evaluatorStats = Array.isArray(evaluatorRows) && evaluatorRows[0]
            ? (evaluatorRows as any)[0]
            : { evaluator_avg_epa: 0, evaluator_report_count: 0 };

        await connection.end();

        return NextResponse.json({
            success: true,
            evaluator_avg_epa: parseFloat(evaluatorStats.evaluator_avg_epa) || null,
            evaluator_report_count: parseInt(evaluatorStats.evaluator_report_count) || 0,
        });

    } catch (err) {
        return NextResponse.json({ success: false, message: 'Server error', error: (err as Error).message }, { status: 500 });
    }
}