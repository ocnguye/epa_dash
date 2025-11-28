import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
// bcryptjs is recommended and expected to be added to package.json
import bcrypt from 'bcryptjs';

const getConnection = async () => {
    return mysql.createConnection({
        host: process.env.AWS_RDS_HOST,
        user: process.env.AWS_RDS_USER,
        password: process.env.AWS_RDS_PWD || process.env.AWS_RDS_PASS,
        database: process.env.AWS_RDS_DB || 'powerscribe',
    });
};

export async function GET(req: NextRequest) {
    const username = req.cookies.get('username')?.value;
    if (!username) return NextResponse.json({ success: false, message: 'Not authenticated' }, { status: 401 });

    const connection = await getConnection();
    try {
        const [rows] = await connection.execute('SELECT * FROM users WHERE username = ?', [username]);
        await connection.end();

        const user = Array.isArray(rows) && rows[0] ? (rows as any)[0] : null;
        if (!user) return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });

        // Return only safe fields
        const safeUser = {
            user_id: Number(user.user_id),
            username: user.username,
            first_name: user.first_name ?? null,
            last_name: user.last_name ?? null,
            preferred_name: user.preferred_name ?? null,
            role: user.role ?? null,
            pgy: typeof user.pgy !== 'undefined' ? Number(user.pgy) : null,
        };
        return NextResponse.json({ success: true, user: safeUser });
    } catch (err) {
        await connection.end();
        return NextResponse.json({ success: false, message: 'Server error', error: (err as Error).message }, { status: 500 });
    }
}

export async function PATCH(req: NextRequest) {
    const currentUsername = req.cookies.get('username')?.value;
    if (!currentUsername) return NextResponse.json({ success: false, message: 'Not authenticated' }, { status: 401 });

    const body = await req.json();
    const {
        username: newUsername,
        password: newPassword,
        preferred_name,
        first_name,
        last_name,
        role: newRole,
        pgy: newPgy,
    } = body || {};

    if (!newUsername && !newPassword && typeof preferred_name === 'undefined' && typeof first_name === 'undefined' && typeof last_name === 'undefined' && typeof newRole === 'undefined' && typeof newPgy === 'undefined') {
        return NextResponse.json({ success: false, message: 'No updatable fields provided' }, { status: 400 });
    }

    const connection = await getConnection();
    await connection.beginTransaction();
    try {
        const [userRows] = await connection.execute('SELECT user_id, username, role FROM users WHERE username = ?', [currentUsername]);
        const userRec = Array.isArray(userRows) && userRows[0] ? (userRows as any)[0] : null;
        if (!userRec) {
            await connection.end();
            return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
        }
        const userId = Number(userRec.user_id);

        const currentUserRole = userRec.role;

        const updates: string[] = [];
        const params: any[] = [];

        if (newUsername && newUsername !== currentUsername) {
            // ensure uniqueness
            const [rows] = await connection.execute('SELECT user_id FROM users WHERE username = ? AND user_id != ?', [newUsername, userId]);
            if (Array.isArray(rows) && rows.length > 0) {
                await connection.end();
                return NextResponse.json({ success: false, message: 'Username already taken' }, { status: 409 });
            }
            updates.push('username = ?');
            params.push(newUsername);
        }

        if (typeof first_name !== 'undefined') {
            updates.push('first_name = ?');
            params.push(first_name);
        }

        if (typeof last_name !== 'undefined') {
            updates.push('last_name = ?');
            params.push(last_name);
        }

        if (newPassword) {
            if (typeof newPassword !== 'string' || newPassword.length < 8) {
                await connection.end();
                return NextResponse.json({ success: false, message: 'Password must be at least 8 characters' }, { status: 400 });
            }
            // hash password using bcryptjs
            const hashed = await bcrypt.hash(newPassword, 10);
            updates.push('password = ?');
            params.push(hashed);
        }

        if (typeof preferred_name !== 'undefined') {
            updates.push('preferred_name = ?');
            params.push(preferred_name);
        }

        if (typeof newPgy !== 'undefined') {
            // basic validation: allow numeric PGY values between 0 and 15
            const pgyNum = Number(newPgy);
            if (!Number.isInteger(pgyNum) || pgyNum < 0 || pgyNum > 15) {
                await connection.end();
                return NextResponse.json({ success: false, message: 'pgy must be an integer between 0 and 15' }, { status: 400 });
            }
            updates.push('pgy = ?');
            params.push(pgyNum);
        }

        if (typeof newRole !== 'undefined') {
            // Changing role is restricted to users with role 'attending'
            if (String(currentUserRole) !== 'attending') {
                await connection.end();
                return NextResponse.json({ success: false, message: "Changing role is allowed only for users with role 'attending'" }, { status: 403 });
            }
            updates.push('role = ?');
            params.push(newRole);
        }

        if (updates.length === 0) {
            await connection.end();
            return NextResponse.json({ success: true, message: 'Nothing to update' });
        }

        const sql = `UPDATE users SET ${updates.join(', ')} WHERE user_id = ?`;
        params.push(userId);

        await connection.execute(sql, params);
        await connection.commit();

        // Update cookie if username changed
        const resp = NextResponse.json({ success: true, message: 'Account updated' });
        if (newUsername && newUsername !== currentUsername) {
            resp.cookies.set('username', newUsername, { path: '/', httpOnly: true, sameSite: 'lax' });
        }

        await connection.end();
        return resp;
    } catch (err) {
        // If preferred_name column doesn't exist, advise adding it
        const msg = (err as Error).message || '';
        await connection.rollback();
        await connection.end();
        if (msg.includes('Unknown column') && msg.includes('preferred_name')) {
            return NextResponse.json({ success: false, message: "Column 'preferred_name' does not exist. Please add it to the users table (e.g. ALTER TABLE users ADD COLUMN preferred_name VARCHAR(255) NULL)" }, { status: 500 });
        }
        return NextResponse.json({ success: false, message: 'Server error', error: msg }, { status: 500 });
    }
}
