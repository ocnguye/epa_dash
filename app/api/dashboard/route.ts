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
            password: process.env.AWS_RDS_PWD,
            database: process.env.AWS_RDS_DB || 'powerscribe',
        });

        // ── Authenticated user ────────────────────────────────────────────────
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
        const user = {
            user_id:        Number(rawUser.user_id),
            username:       rawUser.username,
            first_name:     rawUser.first_name ?? null,
            last_name:      rawUser.last_name  ?? null,
            preferred_name: rawUser.preferred_name ? String(rawUser.preferred_name).trim() : null,
            role:           rawUser.role ?? null,
            pgy:            rawUser.pgy != null ? Number(rawUser.pgy) : null,
        };
        const user_id = user.user_id;

        // ── Procedures for this trainee ───────────────────────────────────────
        //
        // attending_user_ids  – JSON array of attending user_ids on this report,
        //                       e.g. [3, 9].  Used by the client to resolve
        //                       per-attending evaluator stats for the adjusted
        //                       EPA calculation.  We use JSON_ARRAYAGG so every
        //                       row always carries a proper array (never a
        //                       comma-joined string), which avoids the
        //                       attending_user_id=undefined problem seen when
        //                       downstream code tried to treat the GROUP_CONCAT
        //                       string as a single integer key.
        //
        // attending_name      – kept as a human-readable display string.
        const [procedures] = await connection.execute(
            `SELECT
                r.ReportID                                                        AS report_id,
                DATE_FORMAT(r.CreateDate, '%Y-%m-%d')                            AS create_date,
                r.ProcedureDescList                                               AS proc_desc,
                REPLACE(NULLIF(TRIM(r.ProcedureCodeList), ''), ';', ', ')        AS proc_code,
                r.fluoroscopy_time_raw                                            AS fluoroscopy_time_raw,
                r.fluoroscopy_time_minutes                                        AS fluoroscopy_time_minutes,
                r.fluoroscopy_time_unit                                           AS fluoroscopy_time_unit,
                r.fluoroscopy_dose_raw                                            AS fluoroscopy_dose_raw,
                r.fluoroscopy_dose_value                                          AS fluoroscopy_dose_value,
                r.fluoroscopy_dose_unit                                           AS fluoroscopy_dose_unit,
                es.epa_score                                                      AS oepa,
                r.Attending                                                        AS raw_attending,
                r.Trainee                                                          AS raw_trainee,
                CONCAT(u_tr.first_name, ' ', u_tr.last_name)                     AS trainee_name,

                -- Human-readable display string (unchanged behaviour)
                (
                    SELECT GROUP_CONCAT(
                               CONCAT(u_att.first_name, ' ', u_att.last_name)
                               SEPARATOR ', '
                           )
                    FROM   report_participants rp_att
                    JOIN   users u_att ON u_att.user_id = rp_att.user_id
                    WHERE  rp_att.report_id = r.ReportID
                    AND    rp_att.role = 'attending'
                )                                                                 AS attending_name,

                -- Structured array of attending user_ids for evaluator-stats lookup.
                -- JSON_ARRAYAGG preserves one integer per attending; the client
                -- parses this and fans out to the evaluatorStats map.
                (
                    SELECT JSON_ARRAYAGG(rp_att2.user_id)
                    FROM   report_participants rp_att2
                    WHERE  rp_att2.report_id = r.ReportID
                    AND    rp_att2.role = 'attending'
                )                                                                 AS attending_user_ids,

                (
                    CASE
                        WHEN (SELECT SUM(fr.status = 'feedback_requested')
                              FROM   feedback_requests fr
                              WHERE  fr.report_id = r.ReportID
                              AND    fr.trainee_user_id = ?) > 0
                            THEN 'feedback_requested'
                        WHEN (SELECT SUM(fr.status = 'discussed')
                              FROM   feedback_requests fr
                              WHERE  fr.report_id = r.ReportID
                              AND    fr.trainee_user_id = ?) > 0
                            THEN 'discussed'
                        ELSE 'not_required'
                    END
                )                                                                 AS seek_feedback

            FROM  report_participants rp
            JOIN  reports r           ON r.ReportID   = rp.report_id
            JOIN  users   u_tr        ON u_tr.user_id = rp.user_id
            LEFT  JOIN epa_scores es  ON es.report_participant_id = rp.id
            WHERE rp.user_id = ?
            AND   rp.role    = 'trainee'
            ORDER BY r.CreateDate DESC`,
            [user_id, user_id, user_id]
        );

        // ── Evaluator stats: mean + stddev per attending ──────────────────────
        //
        // We compute these once across ALL attendings who have ever evaluated
        // this trainee's peers, then hand the map to the client so it can call
        // computeAdjustedEPA() for each procedure without extra round-trips.
        //
        // The query aggregates over epa_scores keyed through report_participants,
        // so each attending's history is independent of the trainee being viewed.
        const [evaluatorStatsRows] = await connection.execute(
            `SELECT
                rp_att.user_id                        AS attending_user_id,
                ROUND(AVG(es.epa_score), 6)           AS mean_score,
                ROUND(STD(es.epa_score), 6)           AS std_score,
                COUNT(es.epa_score)                   AS eval_count
            FROM report_participants rp_att
            -- find all trainee participants on the same reports this attending was on
            JOIN report_participants rp_trainee
                ON  rp_trainee.report_id = rp_att.report_id
                AND rp_trainee.role      = 'trainee'
            -- the EPA scores belong to the trainee participant, not the attending
            JOIN epa_scores es
                ON  es.report_participant_id = rp_trainee.id
                AND es.epa_score IS NOT NULL
                AND es.epa_score BETWEEN 1 AND 5
            WHERE rp_att.role = 'attending'
            GROUP BY rp_att.user_id
            HAVING COUNT(es.epa_score) >= 2`,
            []
        ) as [any[], any];

        // Shape into a plain object keyed by user_id for O(1) client-side lookup:
        // { 3: { mean: 4.1, stdDev: 0.4, evalCount: 12 }, 9: { ... }, ... }
        const evaluatorStats: Record<number, { mean: number; stdDev: number; evalCount: number }> = {};
        for (const row of evaluatorStatsRows) {
            const id = Number(row.attending_user_id);
            evaluatorStats[id] = {
                mean:      Number(row.mean_score)  || 0,
                stdDev:    Number(row.std_score)   || 0,
                evalCount: Number(row.eval_count)  || 0,
            };
        }

        // Parse attending_user_ids from JSON string → number[] for each procedure row.
        // MySQL returns JSON_ARRAYAGG columns as a string; we normalise here so the
        // client receives a proper array and never has to guess the type.
        const procedureRows = (procedures as any[]).map((row) => {
            let attendingUserIds: number[] = [];
            if (row.attending_user_ids) {
                try {
                    const parsed = typeof row.attending_user_ids === 'string'
                        ? JSON.parse(row.attending_user_ids)
                        : row.attending_user_ids;
                    attendingUserIds = Array.isArray(parsed)
                        ? parsed.map(Number).filter((n: number) => !isNaN(n))
                        : [];
                } catch {
                    attendingUserIds = [];
                }
            }
            return { ...row, attending_user_ids: attendingUserIds };
        });

        // ── Trainee stats ─────────────────────────────────────────────────────
        const [statsRows] = await connection.execute(
            `SELECT
                COALESCE(ROUND(AVG(es_main.epa_score), 2), 0)                AS avg_epa,
                COALESCE(ROUND(AVG(r.fluoroscopy_time_minutes), 2), 0)       AS avg_fluoro_minutes,
                COALESCE(ROUND(AVG(r.fluoroscopy_dose_value), 2), 0)         AS avg_fluoro_dose,
                COUNT(CASE WHEN MONTH(r.CreateDate)  = MONTH(CURRENT_DATE())
                            AND  YEAR(r.CreateDate)  = YEAR(CURRENT_DATE())
                           THEN 1 END)                                        AS procedures,
                COUNT(DISTINCT rp_main.report_id)                             AS total_reports,
                COALESCE((SELECT COUNT(*) FROM feedback_requests fr
                          WHERE fr.trainee_user_id = ? AND fr.status = 'feedback_requested'), 0)
                                                                              AS feedback_requested,
                COALESCE((SELECT COUNT(*) FROM feedback_requests fr
                          WHERE fr.trainee_user_id = ? AND fr.status = 'discussed'), 0)
                                                                              AS feedback_discussed
             FROM  report_participants rp_main
             JOIN  reports    r        ON r.ReportID           = rp_main.report_id
             LEFT  JOIN epa_scores es_main ON es_main.report_participant_id = rp_main.id
             WHERE rp_main.user_id = ?
             AND   rp_main.role    = 'trainee'`,
            [user_id, user_id, user_id]
        ) as [any[], any];

        const stats = statsRows[0] || {};
        const formattedStats: any = {
            avg_epa:             Number(stats.avg_epa)             || 0,
            avg_fluoro_minutes:  Number(stats.avg_fluoro_minutes)  || 0,
            avg_fluoro_dose:     Number(stats.avg_fluoro_dose)     || 0,
            procedures:          Number(stats.procedures)          || 0,
            feedback_requested:  Number(stats.feedback_requested)  || 0,
            feedback_discussed:  Number(stats.feedback_discussed)  || 0,
            total_reports:       Number(stats.total_reports)       || 0,
        };

        // ── Cohort average EPA ─────────────────────────────────────────────────
        let cohortAvg = 0;
        try {
            if (user.pgy !== null) {
                const procFilter = req.nextUrl?.searchParams.get('proc') ?? null;
                let cohortSql = `
                    SELECT COALESCE(ROUND(AVG(es2.epa_score), 2), 0) AS cohort_avg_epa
                    FROM   reports r
                    LEFT   JOIN users u ON (
                               r.trainee = u.user_id
                            OR r.trainee = CONCAT(u.first_name, ' ', u.last_name)
                            OR r.trainee = u.username
                           )
                    LEFT   JOIN report_participants rp2
                               ON rp2.report_id = r.ReportID AND rp2.role = 'trainee'
                    LEFT   JOIN epa_scores es2 ON es2.report_participant_id = rp2.id
                    WHERE  u.pgy     = ?
                    AND    u.user_id != ?`;
                const cohortParams: any[] = [user.pgy, user_id];
                if (procFilter && procFilter.trim() !== '' && procFilter !== 'all') {
                    cohortSql += ` AND (r.ProcedureCodeList LIKE ? OR r.ProcedureDescList LIKE ?)`;
                    cohortParams.push(`%${procFilter.trim()}%`, `%${procFilter.trim()}%`);
                }
                const [cohortRows] = await connection.execute(cohortSql, cohortParams);
                cohortAvg = Number((cohortRows as any[])[0]?.cohort_avg_epa) || 0;
            }
        } catch (e) {
            console.error('Cohort avg query failed:', e);
        }
        formattedStats.cohort_avg_epa = cohortAvg;

        await connection.end();

        return NextResponse.json({
            user,
            procedures: procedureRows,
            stats: formattedStats,
            // Keyed by attending user_id (number).
            // Client usage:
            //   const evs = row.attending_user_ids
            //     .map(id => evaluatorStats[id])
            //     .filter(Boolean);
            //   computeAdjustedEPA({ ..., evaluators: evs });
            evaluatorStats,
        });

    } catch (error) {
        console.error('Dashboard API error:', error);
        return NextResponse.json(
            { success: false, message: 'Server error', error: (error as Error).message },
            { status: 500 }
        );
    }
}