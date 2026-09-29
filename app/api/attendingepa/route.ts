import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { requireUser, AuthError } from '@/lib/requireUser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const me = await requireUser(['attending']);

        const [evaluatorRows] = await pool.execute(
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
            [me.userId],
        );

        const stats: any = (evaluatorRows as any[])[0]
            ?? { evaluator_avg_epa: 0, evaluator_report_count: 0 };

        return NextResponse.json({
            success: true,
            evaluator_avg_epa: parseFloat(stats.evaluator_avg_epa) || null,
            evaluator_report_count: parseInt(stats.evaluator_report_count) || 0,
        });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json({ success: false, message: err.message }, { status: err.status });
        }
        console.error('Evaluator stats error:', (err as Error).message);
        return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 });
    }
}