import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';

const getConnection = async () => mysql.createConnection({
    host: process.env.AWS_RDS_HOST,
    user: process.env.AWS_RDS_USER,
    password: process.env.AWS_RDS_PWD,
    database: process.env.AWS_RDS_DB || 'powerscribe',
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface AttendingProvisionRow {
    attending_user_id: number;
    first_name: string;
    last_name: string;
    preferred_name: string | null;
    // Reports where this attending was present and at least one trainee existed
    reports_with_trainees: number;
    // Of those, reports where every trainee got at least one EPA score
    reports_with_epa: number;
    // Aggregate EPA score stats across all trainee participants they supervised
    avg_epa_score: number | null;
    total_epa_scores_given: number;
}

interface ReportDetailRow {
    report_id: string;
    create_date: string | null;
    procedure_desc: string | null;
    complexity: number;
    attending_user_id: number;
    trainee_user_id: number;
    trainee_first_name: string;
    trainee_last_name: string;
    trainee_preferred_name: string | null;
    trainee_pgy: number | null;
    epa_score: number | null; // null = no EPA given for this trainee on this report
}

// ─── GET /api/admin/epa-provision ────────────────────────────────────────────

export async function GET(req: NextRequest) {
    try {
        const username = req.cookies.get('username')?.value;
        if (!username) {
            return NextResponse.json({ success: false, message: 'Not authenticated' }, { status: 401 });
        }

        const connection = await getConnection();

        // Auth check — admin only
        const [authRows] = await connection.execute(
            'SELECT role FROM users WHERE username = ?',
            [username]
        );
        const auth = Array.isArray(authRows) && authRows[0] ? (authRows as any)[0] : null;
        if (!auth) {
            await connection.end();
            return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
        }
        if (String(auth.role) !== 'admin') {
            await connection.end();
            return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
        }

        // ── Query 1: Per-attending provision summary ──────────────────────────
        //
        // For each attending, find all reports they participated in that also
        // had at least one trainee. Then determine how many of those reports
        // had EPA scores issued to every trainee on the report.
        //
        // "Provision rate" = reports_with_epa / reports_with_trainees * 100
        //
        // A report counts as "EPA provided" if ALL trainees on that report
        // received at least one EPA score — partial coverage counts as missing.

        const [summaryRows] = await connection.execute(`
            SELECT
                u.user_id                                           AS attending_user_id,
                u.first_name,
                u.last_name,
                u.preferred_name,

                -- Total reports this attending was on that had ≥1 trainee
                COUNT(DISTINCT rp_att.report_id)                   AS reports_with_trainees,

                -- Reports where every trainee got ≥1 EPA score
                COUNT(DISTINCT CASE
                    WHEN trainee_totals.total_trainees = trainee_totals.scored_trainees
                    THEN rp_att.report_id
                END)                                               AS reports_with_epa,

                -- Average EPA score across all trainee participants supervised
                ROUND(AVG(es.epa_score), 2)                        AS avg_epa_score,

                -- Raw count of individual EPA scores given
                COUNT(es.id)                                       AS total_epa_scores_given

            FROM report_participants rp_att

            JOIN users u
                ON u.user_id = rp_att.user_id
                AND u.role = 'attending'

            -- Only include reports that had at least one trainee participant
            JOIN (
                SELECT
                    report_id,
                    COUNT(*)                                        AS total_trainees,
                    SUM(CASE WHEN scored.has_score = 1 THEN 1 ELSE 0 END) AS scored_trainees
                FROM report_participants rp_t
                LEFT JOIN (
                    SELECT rp2.id, 1 AS has_score
                    FROM report_participants rp2
                    JOIN epa_scores es2 ON es2.report_participant_id = rp2.id
                    WHERE rp2.role = 'trainee'
                ) scored ON scored.id = rp_t.id
                WHERE rp_t.role = 'trainee'
                GROUP BY report_id
            ) trainee_totals
                ON trainee_totals.report_id = rp_att.report_id

            -- Join trainee participants on the same reports
            JOIN report_participants rp_trainee
                ON rp_trainee.report_id = rp_att.report_id
                AND rp_trainee.role = 'trainee'

            -- Left join EPA scores so we still count reports with no scores
            LEFT JOIN epa_scores es
                ON es.report_participant_id = rp_trainee.id

            WHERE rp_att.role = 'attending'

            GROUP BY u.user_id, u.first_name, u.last_name, u.preferred_name
            ORDER BY
                -- Sort by provision rate ascending (worst offenders first)
                (COUNT(DISTINCT CASE
                    WHEN trainee_totals.total_trainees = trainee_totals.scored_trainees
                    THEN rp_att.report_id
                END) / COUNT(DISTINCT rp_att.report_id)) ASC,
                u.last_name ASC
        `);

        // ── Query 2: Per-report detail for every attending ────────────────────
        //
        // Returns one row per (attending, report, trainee) combination so the
        // frontend can drill down into exactly which reports are missing EPAs.
        // epa_score will be NULL when no score was given for that trainee.

        const [detailRows] = await connection.execute(`
            SELECT
                r.ReportID                  AS report_id,
                r.CreateDate                AS create_date,
                r.ProcedureDescList         AS procedure_desc,
                r.complexity,
                rp_att.user_id              AS attending_user_id,
                rp_trainee.user_id          AS trainee_user_id,
                u_trainee.first_name        AS trainee_first_name,
                u_trainee.last_name         AS trainee_last_name,
                u_trainee.preferred_name    AS trainee_preferred_name,
                u_trainee.pgy               AS trainee_pgy,
                -- Aggregate: if multiple EPA scores exist pick the latest one,
                -- NULL means no EPA was recorded for this trainee on this report
                MAX(es.epa_score)           AS epa_score

            FROM report_participants rp_att

            JOIN report_participants rp_trainee
                ON rp_trainee.report_id = rp_att.report_id
                AND rp_trainee.role = 'trainee'

            JOIN reports r
                ON r.ReportID = rp_att.report_id

            JOIN users u_trainee
                ON u_trainee.user_id = rp_trainee.user_id

            LEFT JOIN epa_scores es
                ON es.report_participant_id = rp_trainee.id

            WHERE rp_att.role = 'attending'

            GROUP BY
                r.ReportID,
                r.CreateDate,
                r.ProcedureDescList,
                r.complexity,
                rp_att.user_id,
                rp_trainee.user_id,
                u_trainee.first_name,
                u_trainee.last_name,
                u_trainee.preferred_name,
                u_trainee.pgy

            ORDER BY rp_att.user_id, r.CreateDate DESC
        `);

        const [missingRows] = await connection.execute(`
            SELECT COUNT(DISTINCT rp.report_id) AS total_missing_epa
            FROM report_participants rp
            LEFT JOIN epa_scores es ON es.report_participant_id = rp.id
            WHERE rp.role = 'trainee'
            AND es.id IS NULL
        `);

        await connection.end();

        // ── Post-process ──────────────────────────────────────────────────────

        const summary = (summaryRows as AttendingProvisionRow[]).map(row => {
            const withTrainees = Number(row.reports_with_trainees);
            const withEpa = Number(row.reports_with_epa);
            const provisionRate = withTrainees > 0
                ? Math.round((withEpa / withTrainees) * 100)
                : null;

            return {
                attending_user_id: row.attending_user_id,
                name: row.preferred_name
                    ? `${row.preferred_name} ${row.last_name}`
                    : `${row.first_name} ${row.last_name}`,
                reports_with_trainees: withTrainees,
                reports_with_epa: withEpa,
                reports_missing_epa: withTrainees - withEpa,
                provision_rate_pct: provisionRate,           // null if no trainee reports
                avg_epa_score: row.avg_epa_score
                    ? parseFloat(String(row.avg_epa_score))
                    : null,
                total_epa_scores_given: Number(row.total_epa_scores_given),
            };
        });

        // Group detail rows by attending_user_id for easy frontend lookup
        const detailsByAttending: Record<number, {
            report_id: string;
            create_date: string | null;
            procedure_desc: string | null;
            complexity: number;
            trainee: {
                user_id: number;
                name: string;
                pgy: number | null;
                epa_score: number | null;
                epa_provided: boolean;
            };
        }[]> = {};

        for (const row of detailRows as ReportDetailRow[]) {
            const attId = row.attending_user_id;
            if (!detailsByAttending[attId]) detailsByAttending[attId] = [];

            detailsByAttending[attId].push({
                report_id: row.report_id,
                create_date: row.create_date,
                procedure_desc: row.procedure_desc,
                complexity: row.complexity,
                trainee: {
                    user_id: row.trainee_user_id,
                    name: row.trainee_preferred_name
                        ? `${row.trainee_preferred_name} ${row.trainee_last_name}`
                        : `${row.trainee_first_name} ${row.trainee_last_name}`,
                    pgy: row.trainee_pgy,
                    epa_score: row.epa_score,
                    epa_provided: row.epa_score !== null,
                },
            });
        }

        const totalMissingEpa = Number((missingRows as any[])[0]?.total_missing_epa ?? 0);

        return NextResponse.json({
            success: true,
            summary,               // array of per-attending provision stats
            details: detailsByAttending, // keyed by attending_user_id
            total_missing_epa: totalMissingEpa,
        });

    } catch (err) {
        return NextResponse.json(
            { success: false, message: 'Server error', error: (err as Error).message },
            { status: 500 }
        );
    }
}