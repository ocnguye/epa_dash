import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';

const getConnection = async () => mysql.createConnection({
    host: process.env.AWS_RDS_HOST,
    user: process.env.AWS_RDS_USER,
    password: process.env.AWS_RDS_PWD || process.env.AWS_RDS_PASS,
    database: process.env.AWS_RDS_DB || 'powerscribe',
});

export async function GET(req: NextRequest, context: any) {
    const { params } = context || {};
    const resolvedParams = params && typeof (params as any).then === 'function' ? await params : params;
    try {
        const username = req.cookies.get('username')?.value;
        if (!username) return NextResponse.json({ success: false, message: 'Not authenticated' }, { status: 401 });

        const connection = await getConnection();

        const [authRows] = await connection.execute('SELECT role, user_id FROM users WHERE username = ?', [username]);
        const auth = Array.isArray(authRows) && (authRows as any)[0] ? (authRows as any)[0] : null;
        if (!auth) {
            await connection.end();
            return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
        }
        if (String(auth.role) !== 'attending') {
            await connection.end();
            return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
        }

        const traineeId = Number(resolvedParams?.id);
        if (!Number.isFinite(traineeId) || traineeId <= 0) {
            await connection.end();
            return NextResponse.json({ success: false, message: 'Invalid trainee id' }, { status: 400 });
        }

        const [userRows] = await connection.execute(
            `SELECT user_id, username, first_name, last_name, preferred_name, pgy, role FROM users WHERE user_id = ?`,
            [traineeId]
        );
        const rawUser = Array.isArray(userRows) && (userRows as any)[0] ? (userRows as any)[0] : null;
        if (!rawUser) {
            await connection.end();
            return NextResponse.json({ success: false, message: 'Trainee not found' }, { status: 404 });
        }

        const user = {
            user_id: Number(rawUser.user_id),
            username: rawUser.username,
            first_name: rawUser.first_name ?? null,
            last_name: rawUser.last_name ?? null,
            preferred_name: rawUser.preferred_name ? String(rawUser.preferred_name).trim() : null,
            pgy: typeof rawUser.pgy !== 'undefined' && rawUser.pgy !== null ? Number(rawUser.pgy) : null,
            role: rawUser.role ?? null,
        } as any;

        // Procedures — driven through report_participants for correct per-trainee EPA isolation
        const [procedures] = await connection.execute(
            `SELECT
                r.ReportID AS report_id,
                DATE_FORMAT(r.CreateDate, '%Y-%m-%d') AS create_date,
                r.ProcedureDescList AS proc_desc,
                REPLACE(NULLIF(TRIM(r.ProcedureCodeList), ''), ';', ', ') AS proc_code,
                es.epa_score AS oepa,
                r.complexity AS complexity,
                CONCAT(u_tr.first_name, ' ', u_tr.last_name) AS trainee_name,
                CONCAT(u_att.first_name, ' ', u_att.last_name) AS attending_name,
                (
                    CASE
                        WHEN (SELECT SUM(fr.status = 'feedback_requested') FROM feedback_requests fr
                              WHERE fr.report_id = r.ReportID AND fr.trainee_user_id = ?) > 0
                            THEN 'feedback_requested'
                        WHEN (SELECT SUM(fr.status = 'discussed') FROM feedback_requests fr
                              WHERE fr.report_id = r.ReportID AND fr.trainee_user_id = ?) > 0
                            THEN 'discussed'
                        ELSE 'not_required'
                    END
                ) AS seek_feedback
            FROM report_participants rp
            JOIN epa_scores es ON es.report_participant_id = rp.id
            JOIN reports r ON r.ReportID = rp.report_id
            JOIN users u_tr ON u_tr.user_id = rp.user_id
            LEFT JOIN report_participants rp_att ON rp_att.report_id = r.ReportID AND rp_att.role = 'attending'
            LEFT JOIN users u_att ON u_att.user_id = rp_att.user_id
            WHERE rp.user_id = ?
              AND rp.role = 'trainee'
            ORDER BY r.CreateDate DESC`,
            [traineeId, traineeId, traineeId]
        );

        // Stats for this specific trainee
        const [statsRows] = await connection.execute(
            `SELECT
                COALESCE(ROUND(AVG(es_main.epa_score), 2), 0) AS avg_epa,
                COUNT(CASE WHEN MONTH(r.CreateDate) = MONTH(CURRENT_DATE()) AND YEAR(r.CreateDate) = YEAR(CURRENT_DATE()) THEN 1 END) AS procedures,
                COUNT(DISTINCT rp_main.report_id) AS total_reports,
                COALESCE((SELECT COUNT(*) FROM feedback_requests fr WHERE fr.trainee_user_id = ? AND fr.status = 'feedback_requested'), 0) AS feedback_requested,
                COALESCE((SELECT COUNT(*) FROM feedback_requests fr WHERE fr.trainee_user_id = ? AND fr.status = 'discussed'), 0) AS feedback_discussed
            FROM report_participants rp_main
            JOIN epa_scores es_main ON es_main.report_participant_id = rp_main.id
            JOIN reports r ON r.ReportID = rp_main.report_id
            WHERE rp_main.user_id = ?
              AND rp_main.role = 'trainee'`,
            [traineeId, traineeId, traineeId]
        ) as [any[], any];

        const stats = (statsRows && statsRows[0]) || {};
        const formattedStats: any = {
            avg_epa: Number(stats.avg_epa) || 0,
            procedures: Number(stats.procedures) || 0,
            feedback_requested: Number(stats.feedback_requested) || 0,
            feedback_discussed: Number(stats.feedback_discussed) || 0,
            total_reports: Number(stats.total_reports) || 0,
        };

        await connection.end();

        return NextResponse.json({ success: true, user, procedures, stats: formattedStats });
    } catch (err) {
        return NextResponse.json({ success: false, message: 'Server error', error: (err as Error).message }, { status: 500 });
    }
}