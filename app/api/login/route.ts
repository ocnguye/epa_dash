import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSession } from '@/lib/session';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    // Kill switch: set ALLOW_PASSWORD_LOGIN=false at SSO cutover
    if (process.env.ALLOW_PASSWORD_LOGIN !== 'true') {
        return NextResponse.json({ success: false, message: 'Use Emory SSO to sign in.' }, { status: 403 });
    }

    try {
        const { username, password } = await req.json();

        if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
            return NextResponse.json({ success: false, message: 'Invalid credentials' }, { status: 400 });
        }

        const [rows] = await pool.execute('SELECT * FROM users WHERE username = ?', [username]);
        const userRow: any = Array.isArray(rows) && rows.length > 0 ? (rows as any)[0] : null;

        if (!userRow) {
            return NextResponse.json({ success: false, message: 'Invalid credentials' }, { status: 401 });
        }

        const stored = userRow.password;
        let matched = false;

        const isBcrypt = typeof stored === 'string' && /^\$2[aby]\$/.test(stored);

        if (isBcrypt) {
            matched = await bcrypt.compare(password, stored);
        } else if (stored === password) {
            // Legacy plaintext row: allow, then upgrade to a bcrypt hash
            matched = true;
            try {
                const hash = await bcrypt.hash(password, 10);
                await pool.execute('UPDATE users SET password = ? WHERE username = ?', [hash, username]);
            } catch (updateErr) {
                console.error('Failed to upgrade plaintext password:', (updateErr as Error).message);
            }
        }

        if (!matched) {
            return NextResponse.json({ success: false, message: 'Invalid credentials' }, { status: 401 });
        }

        const session = await getSession();

        // End any active SSO auth session so its identity/user can't carry over
        if (session.authSessionId) {
            await pool.execute(
                `UPDATE auth_sessions SET ended_at = NOW(), end_reason = 'switch'
                 WHERE auth_session_id = ? AND ended_at IS NULL`,
                [session.authSessionId],
            );
        }
        session.identityId = undefined;
        session.userId = undefined;
        session.authSessionId = undefined;

        // Legacy password session shape
        session.username = username;
        session.role = userRow.role;
        await session.save();

        return NextResponse.json({ success: true, message: 'Login successful' });
    } catch (error) {
        console.error('Login error:', (error as Error).message);
        return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 });
    }
}