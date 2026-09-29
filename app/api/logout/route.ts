import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST() {
    const session = await getSession();
    if (session.authSessionId) {
        await pool.execute(
            `UPDATE auth_sessions SET ended_at = NOW(), end_reason = 'logout'
             WHERE auth_session_id = ? AND ended_at IS NULL`,
            [session.authSessionId],
        );
    }
    session.destroy();
    const res = NextResponse.json({ success: true });
    res.cookies.delete('username'); // clear the old pre-session cookie, if present
    return res;
}