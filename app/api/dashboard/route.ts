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
                -- fluoroscopy fields parsed into reports by the migration script
                r.fluoroscopy_time_raw AS fluoroscopy_time_raw,
                r.fluoroscopy_time_minutes AS fluoroscopy_time_minutes,
                r.fluoroscopy_time_unit AS fluoroscopy_time_unit,
                r.fluoroscopy_dose_raw AS fluoroscopy_dose_raw,
                r.fluoroscopy_dose_value AS fluoroscopy_dose_value,
                r.fluoroscopy_dose_unit AS fluoroscopy_dose_unit,
                r.epa AS oepa,
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
            [user_id, user_id, user_id, user.first_name, user.last_name, user.username]
        );

                // Stats: average EPA from reports + counts. For feedback counts we read from feedback_requests
        const [statsRows] = await connection.execute(
            `SELECT
                COALESCE(ROUND(AVG(CASE WHEN r.epa REGEXP '^[0-9]+(\\.[0-9]+)?$' THEN CAST(r.epa AS DECIMAL(5,2)) END), 2), 0) AS avg_epa,
                COALESCE(ROUND(AVG(r.fluoroscopy_time_minutes), 2), 0) AS avg_fluoro_minutes,
                COALESCE(ROUND(AVG(r.fluoroscopy_dose_value), 2), 0) AS avg_fluoro_dose,
                COUNT(CASE WHEN MONTH(r.CreateDate) = MONTH(CURRENT_DATE()) AND YEAR(r.CreateDate) = YEAR(CURRENT_DATE()) THEN 1 END) AS procedures,
                COUNT(*) AS total_reports,
                COALESCE((SELECT COUNT(*) FROM feedback_requests fr WHERE fr.trainee_user_id = ? AND fr.status = 'feedback_requested'), 0) AS feedback_requested,
                COALESCE((SELECT COUNT(*) FROM feedback_requests fr WHERE fr.trainee_user_id = ? AND fr.status = 'discussed'), 0) AS feedback_discussed
             FROM reports r
             WHERE (
                r.trainee = ?
                OR r.trainee = CONCAT(?, ' ', ?)
                OR r.trainee = ?
             )`,
            [user_id, user_id, user_id, user.first_name, user.last_name, user.username]
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

        // Compute anonymized cohort average EPA for the user's peer cohort (by PGY) when available
        let cohortAvg = 0;
        try {
            if (user.pgy !== null) {
                const [cohortRows] = await connection.execute(
                    `SELECT COALESCE(ROUND(AVG(CASE WHEN r.epa REGEXP '^[0-9]+(\\.[0-9]+)?$' THEN CAST(r.epa AS DECIMAL(5,2)) END), 2), 0) AS cohort_avg_epa
                     FROM reports r
                     LEFT JOIN users u ON (
                        r.trainee = u.user_id
                        OR r.trainee = CONCAT(u.first_name, ' ', u.last_name)
                        OR r.trainee = u.username
                     )
                     WHERE u.pgy = ? AND u.user_id != ?`,
                    [user.pgy, user_id]
                );
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