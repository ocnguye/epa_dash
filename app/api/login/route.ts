import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSession } from '@/lib/session';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    if (process.env.ALLOW_PASSWORD_LOGIN !== 'true') {
        return NextResponse.json({ success: false, message: 'Use Emory SSO to sign in.' }, { status: 403 });
    }

    try {
        const { username, password } = await req.json();

        if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
            return NextResponse.json({ success: false, message: 'Invalid credentials' }, { status: 400 });
        }

        const [rows] = await pool.execute(
            `SELECT * FROM users WHERE username = ?
             ORDER BY FIELD(role, 'admin', 'attending', 'trainee')`,
            [username],
        );
        const candidates = rows as any[];

        let userRow: any = null;
        for (const row of candidates) {
            const stored = row.password;
            const isBcrypt = typeof stored === 'string' && /^\$2[aby]\$/.test(stored);
            const ok = isBcrypt ? await bcrypt.compare(password, stored) : stored === password;
            if (!ok) continue;

            userRow = row;
            if (!isBcrypt) {
                try {
                    const hash = await bcrypt.hash(password, 10);
                    await pool.execute('UPDATE users SET password = ? WHERE user_id = ?', [hash, row.user_id]);
                } catch (updateErr) {
                    console.error('Failed to upgrade plaintext password:', (updateErr as Error).message);
                }
            }
            break;
        }

        if (!userRow) {
            return NextResponse.json({ success: false, message: 'Invalid credentials' }, { status: 401 });
        }

        const session = await getSession();

        if (session.authSessionId) {
            await pool.execute(
                `UPDATE auth_sessions SET ended_at = NOW(), end_reason = 'switch'
                 WHERE auth_session_id = ? AND ended_at IS NULL`,
                [session.authSessionId],
            );
        }
        session.identityId = undefined;
        session.userId = userRow.user_id;
        session.authSessionId = undefined;
        session.username = username;
        session.role = userRow.role;
        await session.save();

        return NextResponse.json({ success: true, message: 'Login successful' });
    } catch (error) {
        console.error('Login error:', (error as Error).message);
        return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 });
    }
}