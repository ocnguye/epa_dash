import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';

export async function GET(req: NextRequest) {
    try {
        const username = req.cookies.get('username')?.value;
        if (!username) {
            return NextResponse.json({ success: false, message: 'Not authenticated' }, { status: 401 });
        }

        // Use configured DB name (default to 'powerscribe' if not set)
        const connection = await mysql.createConnection({
            host: process.env.AWS_RDS_HOST,
            user: process.env.AWS_RDS_USER,
            password: process.env.AWS_RDS_PWD,
            database: process.env.AWS_RDS_DB || 'powerscribe',
        });

        // Get the logged-in user from the `users` table in the powerscribe DB.
        // We keep this simple and only pull fields we need.
        const [userRows] = await connection.execute(
            `SELECT user_id, first_name, last_name, role, username, preferred_name, pgy
             FROM users
             WHERE username = ?`,
            [username]
        );
        if (!Array.isArray(userRows) || userRows.length === 0) {
            await connection.end();
            return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
        }
        const rawUser = userRows[0] as any;
        // Normalize and return only safe fields so frontend receives trimmed values
        const user = {
            user_id: Number(rawUser.user_id),
            username: rawUser.username,
            first_name: rawUser.first_name ?? null,
            last_name: rawUser.last_name ?? null,
            preferred_name: rawUser.preferred_name ? String(rawUser.preferred_name).trim() : null,
            role: rawUser.role ?? null,
            pgy: typeof rawUser.pgy !== 'undefined' && rawUser.pgy !== null ? Number(rawUser.pgy) : null,
        };
        const user_id = Number(user.user_id);

        // Recent reports for this trainee in the powerscribe `reports` table.
        // We also compute a per-report `seek_feedback` status for this trainee by
        // aggregating rows from feedback_requests (priority: feedback_requested > discussed > not_required).
        const [procedures] = await connection.execute(
            `SELECT
                r.ReportID AS report_id,
                DATE_FORMAT(r.CreateDate, '%Y-%m-%d') AS create_date,
                r.ProcedureDescList AS proc_desc,
                REPLACE(NULLIF(TRIM(r.ProcedureCodeList), ''), ';', ', ') AS proc_code,
                r.fluoroscopy_time_raw AS fluoroscopy_time_raw,
                r.fluoroscopy_time_minutes AS fluoroscopy_time_minutes,
                r.fluoroscopy_time_unit AS fluoroscopy_time_unit,
                r.fluoroscopy_dose_raw AS fluoroscopy_dose_raw,
                r.fluoroscopy_dose_value AS fluoroscopy_dose_value,
                r.fluoroscopy_dose_unit AS fluoroscopy_dose_unit,
                es.epa_score AS oepa,
                r.complexity AS complexity,
                r.Attending AS raw_attending,
                r.Trainee AS raw_trainee,
                CONCAT(u_tr.first_name, ' ', u_tr.last_name) AS trainee_name,
                -- GROUP_CONCAT aggregates multiple attendings into one row, e.g. "Dr. Smith, Dr. Jones"
                (
                    SELECT GROUP_CONCAT(CONCAT(u_att.first_name, ' ', u_att.last_name) SEPARATOR ', ')
                    FROM report_participants rp_att
                    JOIN users u_att ON u_att.user_id = rp_att.user_id
                    WHERE rp_att.report_id = r.ReportID AND rp_att.role = 'attending'
                ) AS attending_name,
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
            JOIN reports r ON r.ReportID = rp.report_id
            JOIN users u_tr ON u_tr.user_id = rp.user_id
            LEFT JOIN epa_scores es ON es.report_participant_id = rp.id
            WHERE rp.user_id = ?
            AND rp.role = 'trainee'
            ORDER BY r.CreateDate DESC`,
            [user_id, user_id, user_id]
        );
        
        // Stats: average EPA from reports + counts. For feedback counts we read from feedback_requests
        const [statsRows] = await connection.execute(
        `SELECT
            COALESCE(ROUND(AVG(es_main.epa_score), 2), 0) AS avg_epa,
            COALESCE(ROUND(AVG(r.fluoroscopy_time_minutes), 2), 0) AS avg_fluoro_minutes,
            COALESCE(ROUND(AVG(r.fluoroscopy_dose_value), 2), 0) AS avg_fluoro_dose,
            COUNT(CASE WHEN MONTH(r.CreateDate) = MONTH(CURRENT_DATE()) AND YEAR(r.CreateDate) = YEAR(CURRENT_DATE()) THEN 1 END) AS procedures,
            COUNT(DISTINCT rp_main.report_id) AS total_reports,
            COALESCE((SELECT COUNT(*) FROM feedback_requests fr WHERE fr.trainee_user_id = ? AND fr.status = 'feedback_requested'), 0) AS feedback_requested,
            COALESCE((SELECT COUNT(*) FROM feedback_requests fr WHERE fr.trainee_user_id = ? AND fr.status = 'discussed'), 0) AS feedback_discussed
        FROM report_participants rp_main
        JOIN reports r ON r.ReportID = rp_main.report_id
        LEFT JOIN epa_scores es_main ON es_main.report_participant_id = rp_main.id
        WHERE rp_main.user_id = ?
        AND rp_main.role = 'trainee'`,
        [user_id, user_id, user_id]
    ) as [any[], any];

        const stats = statsRows[0] || {};

        const formattedStats: any = {
            avg_epa: Number(stats.avg_epa) || 0,
            avg_fluoro_minutes: Number(stats.avg_fluoro_minutes) || 0,
            avg_fluoro_dose: Number(stats.avg_fluoro_dose) || 0,
            procedures: Number(stats.procedures) || 0,
            feedback_requested: Number(stats.feedback_requested) || 0,
            feedback_discussed: Number(stats.feedback_discussed) || 0,
            total_reports: Number(stats.total_reports) || 0,
        };

        // Compute anonymized cohort average EPA for the user's peer cohort (by PGY) when available.
        // If a `proc` query parameter is passed, filter cohort reports to that procedure (applies
        // a LIKE match against ProcedureCodeList and ProcedureDescList). This allows the client
        // to request a procedure-specific cohort average (used for the peer cohort line on charts).
        let cohortAvg = 0;
        try {
            if (user.pgy !== null) {
                const procFilter = (req.nextUrl && req.nextUrl.searchParams) ? req.nextUrl.searchParams.get('proc') : null;
                let cohortSql = `SELECT COALESCE(ROUND(AVG(es2.epa_score), 2), 0) AS cohort_avg_epa
                     FROM reports r
                     LEFT JOIN users u ON (
                        r.trainee = u.user_id
                        OR r.trainee = CONCAT(u.first_name, ' ', u.last_name)
                        OR r.trainee = u.username
                     )
                     LEFT JOIN report_participants rp2 ON rp2.report_id = r.ReportID AND rp2.role = 'trainee'
                     LEFT JOIN epa_scores es2 ON es2.report_participant_id = rp2.id
                     WHERE u.pgy = ? AND u.user_id != ?`;
                const cohortParams: any[] = [user.pgy, user_id];
                if (procFilter && String(procFilter).trim() !== '' && String(procFilter) !== 'all') {
                    // Use LIKE matching for the procedure filter
                    cohortSql += ` AND (r.ProcedureCodeList LIKE ? OR r.ProcedureDescList LIKE ?)`;
                    const likeVal = `%${String(procFilter).trim()}%`;
                    cohortParams.push(likeVal, likeVal);
                }

                const [cohortRows] = await connection.execute(cohortSql, cohortParams as any);
                const crow = (cohortRows as any[])[0];
                cohortAvg = crow ? Number(crow.cohort_avg_epa) || 0 : 0;
            }
        } catch (e) {
            console.error('Cohort avg query failed:', e);
            cohortAvg = 0;
        }

        formattedStats.cohort_avg_epa = cohortAvg;

        await connection.end();

        return NextResponse.json({ user, procedures, stats: formattedStats });
    } catch (error) {
        console.error('Dashboard API error:', error);
        return NextResponse.json({ success: false, message: 'Server error', error: (error as Error).message }, { status: 500 });
    }
}