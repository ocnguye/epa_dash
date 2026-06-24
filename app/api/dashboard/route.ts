import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';

export async function GET(req: NextRequest) {
    try {
        const username = req.cookies.get('username')?.value;
        if (!username) {
            return NextResponse.json(
                { success: false, message: 'Not authenticated' },
                { status: 401 }
            );
        }

        const connection = await mysql.createConnection({
            host:     process.env.AWS_RDS_HOST,
            user:     process.env.AWS_RDS_USER,
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
            return NextResponse.json(
                { success: false, message: 'User not found' },
                { status: 404 }
            );
        }
        const rawUser = userRows[0] as any;
        const user = {
            user_id:        Number(rawUser.user_id),
            username:       rawUser.username,
            first_name:     rawUser.first_name     ?? null,
            last_name:      rawUser.last_name      ?? null,
            preferred_name: rawUser.preferred_name
                ? String(rawUser.preferred_name).trim()
                : null,
            role:           rawUser.role           ?? null,
            pgy:            rawUser.pgy != null ? Number(rawUser.pgy) : null,
        };
        const user_id = user.user_id;

        // ── Procedures for this trainee ───────────────────────────────────────
        //
        // All personnel names are resolved exclusively through report_participants
        // + users.  The legacy r.Trainee / r.Attending columns on the reports
        // table are intentionally ignored here; report_participants is the
        // canonical source of truth.
        //
        // attending_name     – comma-separated display string of every attending
        //                      on the report (there may be more than one).
        //
        // attending_user_ids – JSON array of attending user_ids, used by the
        //                      client to fan out evaluator-stats lookups without
        //                      extra round-trips.
        //
        // complexity         – pulled from proc_types via a join on ProcedureCodeList.
        //                      ProcedureCodeList is treated as a single code (1:1).
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

                -- complexity comes from the proc_types lookup table, not epa_scores
                pt.complexity                                                     AS complexity,

                -- Trainee display name resolved from users table via report_participants.
                -- Avoids relying on the free-text r.Trainee column entirely.
                CONCAT(u_tr.first_name, ' ', u_tr.last_name)                     AS trainee_name,

                -- All attendings on the report as a human-readable display string.
                -- Correlated subquery captures every attending participant row,
                -- not just the first one found.
                (
                    SELECT GROUP_CONCAT(
                               CONCAT(u_att.first_name, ' ', u_att.last_name)
                               ORDER BY u_att.last_name
                               SEPARATOR ', '
                           )
                    FROM   report_participants rp_att
                    JOIN   users u_att ON u_att.user_id = rp_att.user_id
                    WHERE  rp_att.report_id = r.ReportID
                    AND    rp_att.role      = 'attending'
                )                                                                 AS attending_name,

                -- Structured JSON array of attending user_ids for O(1) evaluator-
                -- stats lookup on the client.  JSON_ARRAYAGG avoids the ambiguity
                -- of a comma-joined string being mistaken for a single integer.
                (
                    SELECT JSON_ARRAYAGG(rp_att2.user_id)
                    FROM   report_participants rp_att2
                    WHERE  rp_att2.report_id = r.ReportID
                    AND    rp_att2.role       = 'attending'
                )                                                                 AS attending_user_ids,

                -- Feedback status derived from feedback_requests rows, not from
                -- a column on reports (which may be stale).
                (
                    CASE
                        WHEN (
                            SELECT SUM(fr.status = 'feedback_requested')
                            FROM   feedback_requests fr
                            WHERE  fr.report_id       = r.ReportID
                            AND    fr.trainee_user_id = ?
                        ) > 0 THEN 'feedback_requested'
                        WHEN (
                            SELECT SUM(fr.status = 'discussed')
                            FROM   feedback_requests fr
                            WHERE  fr.report_id       = r.ReportID
                            AND    fr.trainee_user_id = ?
                        ) > 0 THEN 'discussed'
                        ELSE 'not_required'
                    END
                )                                                                 AS seek_feedback

            FROM  report_participants rp
            -- resolve the trainee's own user record for their display name
            JOIN  users   u_tr  ON u_tr.user_id = rp.user_id
            JOIN  reports r     ON r.ReportID   = rp.report_id
            -- the EPA score row lives on the trainee's own participant record
            LEFT  JOIN epa_scores es
                       ON  es.report_participant_id = rp.id
            -- complexity is a property of the procedure type, not the individual score
            LEFT  JOIN proc_types pt
                       ON  pt.proc_code = TRIM(r.ProcedureCodeList)

            WHERE rp.user_id = ?
            AND   rp.role    = 'trainee'

            ORDER BY r.CreateDate DESC`,
            [user_id, user_id, user_id]
        );

        // ── Evaluator stats: mean + stddev per attending ──────────────────────
        //
        // Computed across ALL attendings system-wide (not scoped to this trainee)
        // so that the bias correction uses a broad, reliable population.
        //
        // The join path is:
        //   attending participant → same report → trainee participant → epa_scores
        // which correctly attributes the *trainee's* score to the *attending*
        // who evaluated them, without conflating them.
        const [evaluatorStatsRows] = await connection.execute(
            `SELECT
                rp_att.user_id                        AS attending_user_id,
                ROUND(AVG(es.epa_score), 6)           AS mean_score,
                ROUND(STD(es.epa_score), 6)           AS std_score,
                COUNT(es.epa_score)                   AS eval_count
            FROM   report_participants rp_att
            -- find the trainee participant on every report this attending was part of
            JOIN   report_participants rp_trainee
                       ON  rp_trainee.report_id = rp_att.report_id
                       AND rp_trainee.role      = 'trainee'
            -- the EPA score belongs to the trainee's participant row
            JOIN   epa_scores es
                       ON  es.report_participant_id = rp_trainee.id
                       AND es.epa_score IS NOT NULL
                       AND es.epa_score BETWEEN 1 AND 5
            WHERE  rp_att.role = 'attending'
            GROUP  BY rp_att.user_id
            -- require a minimum sample before the correction is trusted
            HAVING COUNT(es.epa_score) >= 2`,
            []
        ) as [any[], any];

        // Shape into { userId: { mean, stdDev, evalCount } } for O(1) client lookup.
        const evaluatorStats: Record<
            number,
            { mean: number; stdDev: number; evalCount: number }
        > = {};
        for (const row of evaluatorStatsRows) {
            const id = Number(row.attending_user_id);
            evaluatorStats[id] = {
                mean:      Number(row.mean_score)  || 0,
                stdDev:    Number(row.std_score)   || 0,
                evalCount: Number(row.eval_count)  || 0,
            };
        }

        // ── Normalise procedure rows ──────────────────────────────────────────
        //
        // MySQL returns JSON_ARRAYAGG columns as a plain string; parse them here
        // so the client always receives a proper number[].
        const procedureRows = (procedures as any[]).map((row) => {
            let attendingUserIds: number[] = [];
            if (row.attending_user_ids) {
                try {
                    const parsed =
                        typeof row.attending_user_ids === 'string'
                            ? JSON.parse(row.attending_user_ids)
                            : row.attending_user_ids;
                    attendingUserIds = Array.isArray(parsed)
                        ? parsed.map(Number).filter((n: number) => !isNaN(n))
                        : [];
                } catch {
                    attendingUserIds = [];
                }
            }
            return {
                ...row,
                attending_user_ids: attendingUserIds,
                // Coerce complexity to a number; null/undefined becomes 0 so the
                // client can easily guard with `complexity > 0`.
                complexity: row.complexity != null ? Number(row.complexity) : 0,
            };
        });

        // ── Trainee aggregate stats ───────────────────────────────────────────
        const [statsRows] = await connection.execute(
            `SELECT
                COALESCE(ROUND(AVG(es_main.epa_score), 2), 0)          AS avg_epa,
                COALESCE(ROUND(AVG(r.fluoroscopy_time_minutes), 2), 0) AS avg_fluoro_minutes,
                COALESCE(ROUND(AVG(r.fluoroscopy_dose_value), 2), 0)   AS avg_fluoro_dose,

                -- procedures logged in the current calendar month
                COUNT(
                    CASE
                        WHEN MONTH(r.CreateDate) = MONTH(CURRENT_DATE())
                         AND YEAR(r.CreateDate)  = YEAR(CURRENT_DATE())
                        THEN 1
                    END
                )                                                        AS procedures,

                COUNT(DISTINCT rp_main.report_id)                       AS total_reports,

                COALESCE((
                    SELECT COUNT(*)
                    FROM   feedback_requests fr
                    WHERE  fr.trainee_user_id = ?
                    AND    fr.status = 'feedback_requested'
                ), 0)                                                    AS feedback_requested,

                COALESCE((
                    SELECT COUNT(*)
                    FROM   feedback_requests fr
                    WHERE  fr.trainee_user_id = ?
                    AND    fr.status = 'discussed'
                ), 0)                                                    AS feedback_discussed

             FROM  report_participants rp_main
             JOIN  reports     r        ON r.ReportID              = rp_main.report_id
             LEFT  JOIN epa_scores es_main
                        ON es_main.report_participant_id = rp_main.id
             WHERE rp_main.user_id = ?
             AND   rp_main.role    = 'trainee'`,
            [user_id, user_id, user_id]
        ) as [any[], any];

        const rawStats = statsRows[0] || {};
        const formattedStats: any = {
            avg_epa:            Number(rawStats.avg_epa)            || 0,
            avg_fluoro_minutes: Number(rawStats.avg_fluoro_minutes) || 0,
            avg_fluoro_dose:    Number(rawStats.avg_fluoro_dose)    || 0,
            procedures:         Number(rawStats.procedures)         || 0,
            feedback_requested: Number(rawStats.feedback_requested) || 0,
            feedback_discussed: Number(rawStats.feedback_discussed) || 0,
            total_reports:      Number(rawStats.total_reports)      || 0,
        };

        // ── Cohort average EPA (same PGY, excluding this trainee) ─────────────
        let cohortAvg = 0;
        try {
            if (user.pgy !== null) {
                const procFilter = req.nextUrl?.searchParams.get('proc') ?? null;

                // Cohort average is computed through report_participants so the
                // join path is consistent with the rest of the query.
                let cohortSql = `
                    SELECT COALESCE(ROUND(AVG(es2.epa_score), 2), 0) AS cohort_avg_epa
                    FROM   report_participants rp2
                    JOIN   users u2   ON u2.user_id = rp2.user_id
                    JOIN   reports r2 ON r2.ReportID = rp2.report_id
                    LEFT   JOIN epa_scores es2
                               ON es2.report_participant_id = rp2.id
                    WHERE  rp2.role   = 'trainee'
                    AND    u2.pgy     = ?
                    AND    u2.user_id != ?`;

                const cohortParams: any[] = [user.pgy, user_id];

                if (procFilter && procFilter.trim() !== '' && procFilter !== 'all') {
                    cohortSql += ` AND (
                        r2.ProcedureCodeList LIKE ?
                        OR r2.ProcedureDescList LIKE ?
                    )`;
                    cohortParams.push(
                        `%${procFilter.trim()}%`,
                        `%${procFilter.trim()}%`
                    );
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
            procedures:     procedureRows,
            stats:          formattedStats,
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