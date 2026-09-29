import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { pool } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireUser, AuthError } from '@/lib/requireUser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fail = (message: string, status: number) =>
    NextResponse.json({ success: false, message }, { status });

const authResponse = (err: unknown) =>
    err instanceof AuthError ? fail(err.message, err.status) : null;

export async function GET() {
    try {
        const me = await requireUser();
        const [rows] = await pool.execute(
            `SELECT user_id, username, first_name, last_name, preferred_name, role, pgy
             FROM users WHERE user_id = ?`,
            [me.userId],
        );
        const u: any = (rows as any[])[0];
        if (!u) return fail('User not found', 404);

        return NextResponse.json({
            success: true,
            user: {
                user_id: Number(u.user_id),
                username: u.username,
                first_name: u.first_name ?? null,
                last_name: u.last_name ?? null,
                preferred_name: u.preferred_name ?? null,
                role: u.role ?? null,
                pgy: u.pgy == null ? null : Number(u.pgy),
            },
        });
    } catch (err) {
        const r = authResponse(err);
        if (r) return r;
        console.error('User fetch error:', (err as Error).message);
        return fail('Server error', 500);
    }
}

export async function PATCH(req: NextRequest) {
    let me;
    try {
        me = await requireUser();
    } catch (err) {
        const r = authResponse(err);
        if (r) return r;
        console.error('User update auth error:', (err as Error).message);
        return fail('Server error', 500);
    }

    const body = await req.json().catch(() => ({}));
    // `role` is intentionally not accepted here
    const { username: newUsername, password: newPassword, preferred_name, first_name, last_name, pgy: newPgy } = body || {};

    if (!newUsername && !newPassword && typeof preferred_name === 'undefined'
        && typeof first_name === 'undefined' && typeof last_name === 'undefined'
        && typeof newPgy === 'undefined') {
        return fail('No updatable fields provided', 400);
    }

    const updates: string[] = [];
    const params: any[] = [];
    let usernameChanged = false;

    if (typeof newUsername === 'string' && newUsername.trim() && newUsername.trim() !== me.username) {
        const v = newUsername.trim();
        if (v.length > 100) return fail('Username is too long', 400);
        updates.push('username = ?'); params.push(v);
        usernameChanged = true;
    }
    if (typeof first_name === 'string') {
        if (!first_name.trim() || first_name.length > 100) return fail('Invalid first name', 400);
        updates.push('first_name = ?'); params.push(first_name.trim());
    }
    if (typeof last_name === 'string') {
        if (!last_name.trim() || last_name.length > 100) return fail('Invalid last name', 400);
        updates.push('last_name = ?'); params.push(last_name.trim());
    }
    if (typeof preferred_name === 'string') {
        if (preferred_name.length > 255) return fail('Preferred name is too long', 400);
        updates.push('preferred_name = ?'); params.push(preferred_name.trim() || null);
    }
    if (newPassword) {
        if (process.env.ALLOW_PASSWORD_LOGIN !== 'true') {
            return fail('Password sign-in is disabled. Use Emory SSO.', 403);
        }
        if (typeof newPassword !== 'string' || newPassword.length < 8) {
            return fail('Password must be at least 8 characters', 400);
        }
        updates.push('password = ?'); params.push(await bcrypt.hash(newPassword, 10));
    }
    if (typeof newPgy !== 'undefined') {
        const pgyNum = Number(newPgy);
        if (!Number.isInteger(pgyNum) || pgyNum < 0 || pgyNum > 15) {
            return fail('pgy must be an integer between 0 and 15', 400);
        }
        updates.push('pgy = ?'); params.push(pgyNum);
    }

    if (updates.length === 0) return NextResponse.json({ success: true, message: 'Nothing to update' });

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        await conn.execute(`UPDATE users SET ${updates.join(', ')} WHERE user_id = ?`, [...params, me.userId]);
        await conn.commit();
    } catch (err: any) {
        await conn.rollback().catch(() => {});
        if (err?.code === 'ER_DUP_ENTRY') return fail('Username already taken', 409);
        console.error('User update error:', err?.message);
        return fail('Server error', 500);
    } finally {
        conn.release();
    }

    if (usernameChanged) {
        const session = await getSession();
        session.username = String(newUsername).trim();
        await session.save();
    }

    return NextResponse.json({ success: true, message: 'Account updated' });
}