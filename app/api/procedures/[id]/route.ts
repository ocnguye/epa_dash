import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { status, notes } = await request.json();
        const { id } = await params;
        const reportId = id;

        // Validate status
        const allowedStatuses = ['not_required', 'feedback_requested', 'discussed'];
        if (!allowedStatuses.includes(status)) {
            return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
        }

        const connection = await mysql.createConnection({
            host: process.env.AWS_RDS_HOST,
            user: process.env.AWS_RDS_USER,
            password: process.env.AWS_RDS_PWD,
            // Use configured DB (default to 'powerscribe') so this route can point at the real data DB
            database: process.env.AWS_RDS_DB || 'powerscribe',
        });

        // Authenticate user from cookie (used as requested_by)
        const username = request.cookies.get('username')?.value;
        if (!username) {
            await connection.end();
            return NextResponse.json({ success: false, message: 'Not authenticated' }, { status: 401 });
        }

        const [userRows] = await connection.execute(
            'SELECT user_id FROM users WHERE username = ?',
            [username]
        );
        const user = Array.isArray(userRows) && userRows[0] ? (userRows as any)[0] : null;
        const requestedBy = user ? Number(user.user_id) : null;

        // Start transaction to make updates atomic
        await connection.beginTransaction();
        try {
            let affectedTotal = 0;
            if (status === 'feedback_requested') {
                // Create or update a triad row for every trainee x attending for this report
                const [res] = await connection.execute(
                    `INSERT INTO feedback_requests (report_id, trainee_user_id, attending_user_id, status, requested_by, notes)
                     SELECT rp_t.report_id, rp_t.user_id, rp_a.user_id, ?, ?, ?
                     FROM report_participants rp_t
                     JOIN report_participants rp_a ON rp_t.report_id = rp_a.report_id
                     WHERE rp_t.role = 'trainee' AND rp_a.role = 'attending' AND rp_t.report_id = ?
                     ON DUPLICATE KEY UPDATE
                       status = VALUES(status),
                       requested_by = VALUES(requested_by),
                       notes = COALESCE(VALUES(notes), notes),
                       updated_at = NOW()`,
                    [status, requestedBy, notes || null, reportId]
                );
                affectedTotal = (res as any).affectedRows || 0;
            } else if (status === 'discussed') {
                // Mark the report as discussed for all triads so all participants see the change
                const [res] = await connection.execute(
                    'UPDATE feedback_requests SET status = ?, updated_at = NOW() WHERE report_id = ?',
                    [status, reportId]
                );
                const affected = (res as any).affectedRows || 0;
                affectedTotal = affected;
            } else if (status === 'not_required') {
                // Clear or reset triads for this report
                const [res] = await connection.execute(
                    'UPDATE feedback_requests SET status = ?, updated_at = NOW() WHERE report_id = ?',
                    [status, reportId]
                );
                affectedTotal = (res as any).affectedRows || 0;
            }

            await connection.commit();
            // For debugging: include which DB and how many rows were affected
            const dbName = process.env.AWS_RDS_DB || 'powerscribe';
            const dbHost = process.env.AWS_RDS_HOST || '';
            await connection.end();
            return NextResponse.json({ success: true, affectedRows: affectedTotal, database: dbName, host: dbHost });
        } catch (err) {
            await connection.rollback();
            await connection.end();
            console.error('Feedback update error:', err);
            return NextResponse.json({ error: 'Failed to update feedback' }, { status: 500 });
        }
    } catch (error) {
        console.error('Status update error:', error);
        return NextResponse.json({ error: 'Failed to update status' }, { status: 500 });
    }
}