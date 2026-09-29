import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { requireUser, AuthError } from '@/lib/requireUser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        await requireUser(['attending']);

        const [rows] = await pool.execute(
            `SELECT
                u.user_id,
                u.username,
                u.first_name,
                u.last_name,
                u.preferred_name,
                u.pgy,
                u.role,
                COALESCE(ROUND(AVG(es.epa_score), 2), 0) AS avg_epa,
                COUNT(DISTINCT rp.report_id) AS report_count
             FROM users u
             LEFT JOIN report_participants rp ON rp.user_id = u.user_id AND rp.role = 'trainee'
             LEFT JOIN epa_scores es ON es.report_participant_id = rp.id
             WHERE u.role = 'trainee'
             GROUP BY u.user_id
             ORDER BY avg_epa DESC, u.pgy DESC`
        );

        return NextResponse.json({ success: true, trainees: rows });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json({ success: false, message: err.message }, { status: err.status });
        }
        console.error('Trainees list error:', (err as Error).message);
        return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 });
    }
}