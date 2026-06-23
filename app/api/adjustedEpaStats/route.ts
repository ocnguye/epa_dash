/**
 * /api/adjustedEpaStats/route.ts
 *
 * Returns two lookup maps needed to hydrate computeAdjustedEpa():
 *
 *   evaluatorStats    – µe / σe per attending, keyed by attending_user_id
 *   procedureMedians  – median fluoro time and/or dose per procedure code,
 *                       keyed by proc_code (lowercased)
 *
 * Accessible by: trainee | attending | admin
 *
 * All three roles receive the same evaluatorStats and procedureMedians payload.
 * Trainees need this to render adjusted EPA on their own dashboard.
 * Attendings and admins may use it for their own views.
 *
 * ── Evaluator exclusion rules ─────────────────────────────────────────────────
 *
 *   A) epa_score IS NULL / not between 1–5
 *      Missing/NR — excluded so absent scores don't skew µe or σe.
 *
 *   B) Attending has zero valid scores.
 *      HAVING clause produces no row → frontend falls back to Zeval = 0.
 *
 *   C) Attending has exactly 1 valid score.
 *      HAVING valid_score_count >= 2 excludes them — STDDEV_POP of a single
 *      value is 0, making the z-score undefined. Zeval → 0 for their scores.
 *
 * ── Metric availability by scan type ─────────────────────────────────────────
 *
 *   Fluoroscopy  → fluoroscopy_time_minutes + fluoroscopy_dose_value
 *   CT           → fluoroscopy_dose_value only (time structurally NULL)
 *   Medians computed independently per metric so CT procedures still get
 *   a valid radiationDoseMedian with a null fluoroTimeMedian.
 */

import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';

const getConnection = async () =>
    mysql.createConnection({
        host: process.env.AWS_RDS_HOST,
        user: process.env.AWS_RDS_USER,
        password: process.env.AWS_RDS_PWD,
        database: process.env.AWS_RDS_DB || 'powerscribe',
    });

interface EvaluatorStatsRow {
    attending_user_id: number;
    evaluator_mean: number;
    evaluator_std_dev: number;
    valid_score_count: number;
}

interface ProcedureMedianRow {
    proc_code: string;
    proc_desc: string;
    complexity: number | null;
    fluoro_time_median: number | null;
    fluoro_time_sample: number;
    dose_median: number | null;
    dose_sample: number;
    has_ct_reports: number;
}

export async function GET(req: NextRequest) {
    try {
        const username = req.cookies.get('username')?.value;
        if (!username) {
            return NextResponse.json(
                { success: false, message: 'Not authenticated' },
                { status: 401 }
            );
        }

        const connection = await getConnection();

        // ── Auth: any authenticated user may call this endpoint ───────────────
        const [authRows] = await connection.execute(
            'SELECT role, user_id FROM users WHERE username = ?',
            [username]
        );
        const auth = Array.isArray(authRows) && authRows[0]
            ? (authRows as any)[0]
            : null;

        if (!auth) {
            await connection.end();
            return NextResponse.json(
                { success: false, message: 'User not found' },
                { status: 404 }
            );
        }

        // No role restriction — any authenticated user may fetch aggregate
        // evaluator stats and procedure medians. No individual scores or other
        // trainees' data are exposed; this is safe for all roles.

        // ── Query 1: Evaluator statistics ──────────────────────────────────────
        // All roles receive the full evaluatorStats map — trainees need it to
        // compute adjusted EPA for scores given to them by any attending.
        // No per-user scoping here; the data is attending-level aggregates only
        // (no individual scores or PII beyond attending_user_id are exposed).

        const [evaluatorRows] = await connection.execute(`
            SELECT
                rp_att.user_id                      AS attending_user_id,
                ROUND(AVG(es.epa_score), 4)         AS evaluator_mean,
                ROUND(STDDEV_POP(es.epa_score), 4)  AS evaluator_std_dev,
                COUNT(es.id)                        AS valid_score_count
            FROM report_participants rp_att
            JOIN report_participants rp_trainee
                ON  rp_trainee.report_id = rp_att.report_id
                AND rp_trainee.role      = 'trainee'
            JOIN epa_scores es
                ON  es.report_participant_id = rp_trainee.id
                AND es.epa_score IS NOT NULL
                AND es.epa_score BETWEEN 1 AND 5
            WHERE rp_att.role = 'attending'
            GROUP BY rp_att.user_id
            HAVING valid_score_count >= 2
        `);

        // ── Query 2: Per-procedure medians + complexity ────────────────────────

        const [procedureRows] = await connection.execute(`
            SELECT
                pt.proc_code,
                pt.proc_desc,
                pt.complexity,

                (
                    SELECT AVG(sub.fluoroscopy_time_minutes)
                    FROM (
                        SELECT
                            r2.fluoroscopy_time_minutes,
                            ROW_NUMBER() OVER (ORDER BY r2.fluoroscopy_time_minutes) AS rn,
                            COUNT(*)     OVER ()                                     AS cnt
                        FROM reports r2
                        WHERE r2.ProcedureCodeList = pt.proc_code
                          AND r2.fluoroscopy_time_minutes IS NOT NULL
                    ) sub
                    WHERE sub.rn IN (
                        FLOOR((sub.cnt + 1) / 2),
                        CEIL((sub.cnt + 1) / 2)
                    )
                )                                           AS fluoro_time_median,

                SUM(CASE WHEN r.fluoroscopy_time_minutes IS NOT NULL THEN 1 ELSE 0 END)
                                                            AS fluoro_time_sample,

                (
                    SELECT AVG(sub.fluoroscopy_dose_value)
                    FROM (
                        SELECT
                            r2.fluoroscopy_dose_value,
                            ROW_NUMBER() OVER (ORDER BY r2.fluoroscopy_dose_value) AS rn,
                            COUNT(*)     OVER ()                                   AS cnt
                        FROM reports r2
                        WHERE r2.ProcedureCodeList = pt.proc_code
                          AND r2.fluoroscopy_dose_value IS NOT NULL
                    ) sub
                    WHERE sub.rn IN (
                        FLOOR((sub.cnt + 1) / 2),
                        CEIL((sub.cnt + 1) / 2)
                    )
                )                                           AS dose_median,

                SUM(CASE WHEN r.fluoroscopy_dose_value IS NOT NULL THEN 1 ELSE 0 END)
                                                            AS dose_sample,

                SUM(CASE WHEN r.scan_type = 'CT' THEN 1 ELSE 0 END)
                                                            AS has_ct_reports

            FROM proc_types pt
            LEFT JOIN reports r ON r.ProcedureCodeList = pt.proc_code
            GROUP BY pt.proc_code, pt.proc_desc, pt.complexity
            ORDER BY pt.proc_code
        `);

        await connection.end();

        // ── Shape evaluator stats ──────────────────────────────────────────────

        const evaluatorStats: Record<number, {
            mean: number;
            stdDev: number;
            validScoreCount: number;
            biasAdjustmentApplicable: boolean;
        }> = {};

        for (const row of evaluatorRows as EvaluatorStatsRow[]) {
            const std = parseFloat(String(row.evaluator_std_dev)) || 0;
            evaluatorStats[row.attending_user_id] = {
                mean: parseFloat(String(row.evaluator_mean)),
                stdDev: std,
                validScoreCount: Number(row.valid_score_count),
                biasAdjustmentApplicable: std > 0,
            };
        }

        // ── Shape procedure medians ────────────────────────────────────────────

        const procedureMedians: Record<string, {
            procDesc: string;
            complexity: 1 | 2 | 3 | 4 | 5 | null;
            fluoroTimeMedian: number | null;
            fluoroTimeSample: number;
            radiationDoseMedian: number | null;
            radiationDoseSample: number;
            isCTProcedure: boolean;
        }> = {};

        for (const row of procedureRows as ProcedureMedianRow[]) {
            const key = row.proc_code.trim().toLowerCase();
            const rawComplexity = row.complexity != null ? Number(row.complexity) : null;
            const complexity =
                rawComplexity != null && rawComplexity >= 1 && rawComplexity <= 5
                    ? (rawComplexity as 1 | 2 | 3 | 4 | 5)
                    : null;

            procedureMedians[key] = {
                procDesc: row.proc_desc,
                complexity,
                fluoroTimeMedian: row.fluoro_time_median != null
                    ? parseFloat(String(row.fluoro_time_median))
                    : null,
                fluoroTimeSample: Number(row.fluoro_time_sample),
                radiationDoseMedian: row.dose_median != null
                    ? parseFloat(String(row.dose_median))
                    : null,
                radiationDoseSample: Number(row.dose_sample),
                isCTProcedure: Number(row.has_ct_reports) > 0,
            };
        }

        return NextResponse.json({
            success: true,
            evaluatorStats,
            procedureMedians,
        });

    } catch (err) {
        return NextResponse.json(
            {
                success: false,
                message: 'Server error',
                error: (err as Error).message,
            },
            { status: 500 }
        );
    }
}