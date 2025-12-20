import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';

const getConnection = async () => mysql.createConnection({
    host: process.env.AWS_RDS_HOST,
    user: process.env.AWS_RDS_USER,
    password: process.env.AWS_RDS_PWD || process.env.AWS_RDS_PASS,
    database: process.env.AWS_RDS_DB || 'powerscribe',
});

export async function GET(req: NextRequest, context: any) {
    // In some Next.js versions `context.params` may be a Promise. Await if needed.
    const { params } = context || {};
    const resolvedParams = params && typeof (params as any).then === 'function' ? await params : params;
    try {
        const username = req.cookies.get('username')?.value;
        if (!username) return NextResponse.json({ success: false, message: 'Not authenticated' }, { status: 401 });

        const connection = await getConnection();

        // verify requester role is attending
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

        // Load trainee basic info
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

        // Pull procedures for this trainee (similar to dashboard API) and compute seek_feedback per report
        const [procedures] = await connection.execute(
            `SELECT
                r.ReportID AS report_id,
                DATE_FORMAT(r.CreateDate, '%Y-%m-%d') AS create_date,
                r.ProcedureDescList AS proc_desc,
                REPLACE(NULLIF(TRIM(r.ProcedureCodeList), ''), ';', ', ') AS proc_code,
                                (
                                    SELECT es.epa_score
                                    FROM report_participants rp2
                                    JOIN epa_scores es ON es.report_participant_id = rp2.id
                                    WHERE rp2.report_id = r.ReportID AND rp2.role = 'trainee'
                                    LIMIT 1
                                ) AS oepa,
                r.complexity AS complexity,
                r.Attending AS raw_attending,
                r.Trainee AS raw_trainee,
                CONCAT(u1.first_name, ' ', u1.last_name) AS trainee_name,
                CONCAT(u2.first_name, ' ', u2.last_name) AS attending_name,
                (
                  CASE
                    WHEN (
                      SELECT SUM(fr.status = 'feedback_requested') FROM feedback_requests fr
                      WHERE fr.report_id = r.ReportID AND fr.trainee_user_id = ?
                    ) > 0 THEN 'feedback_requested'
                    WHEN (
                      SELECT SUM(fr.status = 'discussed') FROM feedback_requests fr
                      WHERE fr.report_id = r.ReportID AND fr.trainee_user_id = ?
                    ) > 0 THEN 'discussed'
                    ELSE 'not_required'
                  END
                ) AS seek_feedback
            FROM reports r
            LEFT JOIN users u1 ON (
                r.trainee = u1.user_id
                OR r.trainee = CONCAT(u1.first_name, ' ', u1.last_name)
                OR r.trainee = u1.username
            )
            LEFT JOIN users u2 ON (
                r.attending = u2.user_id
                OR r.attending = CONCAT(u2.first_name, ' ', u2.last_name)
                OR r.attending = u2.username
            )
            WHERE (
                r.trainee = ?
                OR r.trainee = CONCAT(?, ' ', ?)
                OR r.trainee = ?
            )
            ORDER BY r.CreateDate DESC`,
            [traineeId, traineeId, traineeId, user.first_name, user.last_name, user.username]
        );

        // Stats: average EPA and counts
        const [statsRows] = await connection.execute(
            `SELECT
                COALESCE(ROUND(AVG(es_main.epa_score), 2), 0) AS avg_epa,
                COUNT(CASE WHEN MONTH(r.CreateDate) = MONTH(CURRENT_DATE()) AND YEAR(r.CreateDate) = YEAR(CURRENT_DATE()) THEN 1 END) AS procedures,
                COUNT(*) AS total_reports,
                COALESCE((SELECT COUNT(*) FROM feedback_requests fr WHERE fr.trainee_user_id = ? AND fr.status = 'feedback_requested'), 0) AS feedback_requested,
                COALESCE((SELECT COUNT(*) FROM feedback_requests fr WHERE fr.trainee_user_id = ? AND fr.status = 'discussed'), 0) AS feedback_discussed
             FROM reports r
             LEFT JOIN report_participants rp_main ON rp_main.report_id = r.ReportID AND rp_main.role = 'trainee'
             LEFT JOIN epa_scores es_main ON es_main.report_participant_id = rp_main.id
             WHERE (
                r.trainee = ?
                OR r.trainee = CONCAT(?, ' ', ?)
                OR r.trainee = ?
             )`,
            [traineeId, traineeId, traineeId, user.first_name, user.last_name, user.username]
        ) as [any[], any];

        const stats = (statsRows && statsRows[0]) || {};
        const formattedStats = {
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
