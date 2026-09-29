// app/api/auth/select-account/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getSession } from '@/lib/session';
import { startAuthSession } from '@/lib/authSession';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const session = await getSession();
    if (!session.identityId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const userId = Number(body?.userId);
    if (!Number.isInteger(userId)) {
        return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }

    const [rows] = await pool.execute(
        `SELECT u.user_id, u.username, u.role
         FROM user_sso_links l
         JOIN users u ON u.user_id = l.user_id
         WHERE l.sso_identity_id = ? AND l.user_id = ? AND l.disabled_at IS NULL`,
        [session.identityId, userId],
    );
    const user: any = (rows as any[])[0];
    if (!user) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Closes the previous auth_sessions row ('switch'), opens a new one,
    // and rewrites the cookie with the new userId/role/authSessionId.
    await startAuthSession(session, session.identityId, user);

    return NextResponse.json({ ok: true, role: user.role });
}