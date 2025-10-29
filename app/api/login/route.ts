import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';

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

        // Query the users table for the provided username and password
        const [rows] = await connection.execute(
            'SELECT * FROM users WHERE username = ? AND password = ?',
            [username, password]
        );

        await connection.end();

        if (Array.isArray(rows) && rows.length > 0) {
            const response = NextResponse.json({ success: true, message: 'Login successful' });
            response.cookies.set('username', username, { path: '/', httpOnly: true, sameSite: 'lax' });
            return response;
        } else {
            return NextResponse.json({ success: false, message: 'Invalid credentials' }, { status: 401 });
        }
    } catch (error) {
        return NextResponse.json({ success: false, message: 'Server error', error: (error as Error).message }, { status: 500 });
    }
}