import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

export async function POST(req: NextRequest) {
    try {
        const { username, password } = await req.json();

        // Create a connection to the MySQL database
        const connection = await mysql.createConnection({
            host: process.env.AWS_RDS_HOST,
            user: process.env.AWS_RDS_USER,
            password: process.env.AWS_RDS_PWD,
            database: process.env.AWS_RDS_DB || 'powerscribe',
        });

        // Query the users table for the provided username
        const [rows] = await connection.execute('SELECT * FROM users WHERE username = ?', [username]);

        // rows is typed as any; handle missing user
        const userRow: any = Array.isArray(rows) && rows.length > 0 ? (rows as any)[0] : null;

        if (!userRow) {
            await connection.end();
            return NextResponse.json({ success: false, message: 'Invalid credentials' }, { status: 401 });
        }

        const stored = userRow.password;
        let matched = false;

        // Detect bcrypt hash (starts with $2a$ or $2b$ or $2y$)
        const isBcrypt = typeof stored === 'string' && /^\$2[aby]\$/.test(stored);

        if (isBcrypt) {
            matched = await bcrypt.compare(password, stored);
        } else {
            // legacy plaintext password in DB — allow login if exact match,
            // and upgrade the stored password to a bcrypt hash for future logins
            if (stored === password) matched = true;
            if (matched) {
                try {
                    const hash = await bcrypt.hash(password, 10);
                    await connection.execute('UPDATE users SET password = ? WHERE username = ?', [hash, username]);
                } catch (updateErr) {
                    // Non-fatal: log and continue with successful login
                    // eslint-disable-next-line no-console
                    console.error('Failed to upgrade plaintext password to bcrypt:', (updateErr as Error).message);
                }
            }
        }

        await connection.end();

        if (matched) {
            const response = NextResponse.json({ success: true, message: 'Login successful' });
            response.cookies.set('username', username, { path: '/', httpOnly: true, sameSite: 'lax' });
            return response;
        }

        return NextResponse.json({ success: false, message: 'Invalid credentials' }, { status: 401 });
    } catch (error) {
        return NextResponse.json({ success: false, message: 'Server error', error: (error as Error).message }, { status: 500 });
    }
}