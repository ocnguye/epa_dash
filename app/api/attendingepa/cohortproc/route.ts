import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';

const getConnection = async () => mysql.createConnection({
    host: process.env.AWS_RDS_HOST,
    user: process.env.AWS_RDS_USER,
    password: process.env.AWS_RDS_PWD || process.env.AWS_RDS_PASS,
    database: process.env.AWS_RDS_DB || 'powerscribe',
});

export async function GET(req: NextRequest) {
    try {
        const username = req.cookies.get('username')?.value;
        if (!username) {
            return NextResponse.json({ success: false, message: 'Not authenticated' }, { status: 401 });
        }

        const connection = await getConnection();

        const [authRows] = await connection.execute(
            'SELECT role FROM users WHERE username = ?',
            [username]
        );
        const auth = Array.isArray(authRows) && (authRows as any)[0] ? (authRows as any)[0] : null;
        if (!auth || String(auth.role) !== 'attending') {
            await connection.end();
            return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
        }

        const { searchParams } = new URL(req.url);
        const pgyParam = searchParams.get('pgy');
        const pgy = pgyParam ? Number(pgyParam) : null;

        // Mirror the exact same EPA score subquery used in the trainee drill-down
        const query = `
            SELECT
                r.ProcedureDescList AS proc_desc,
                REPLACE(NULLIF(TRIM(r.ProcedureCodeList), ''), ';', ', ') AS proc_code,
                (
                    SELECT es.epa_score
                    FROM report_participants rp2
                    JOIN epa_scores es ON es.report_participant_id = rp2.id
                    WHERE rp2.report_id = r.ReportID AND rp2.role = 'trainee'
                    LIMIT 1
                ) AS oepa,
                u.pgy
            FROM reports r
            JOIN users u ON (
                r.trainee = u.user_id
                OR r.trainee = CONCAT(u.first_name, ' ', u.last_name)
                OR r.trainee = u.username
            )
            WHERE u.role = 'trainee'
              ${pgy !== null ? 'AND u.pgy = ?' : ''}
        `;
        const params: any[] = pgy !== null ? [pgy] : [];

        const [rows] = await connection.execute(query, params) as any[];
        await connection.end();

        // Aggregate per procedure — same logic as the component's useMemo
        const statsMap: Record<string, { desc: string; code: string; sum: number; count: number; totalCount: number }> = {};

        for (const row of rows) {
            const desc = row.proc_desc ? String(row.proc_desc).trim() : '';
            const code = row.proc_code ? String(row.proc_code).trim() : '';
            const key = desc || code || 'Unknown';

            if (!statsMap[key]) {
                statsMap[key] = { desc: desc || code || 'Unknown', code, sum: 0, count: 0, totalCount: 0 };
            }
            statsMap[key].totalCount += 1;

            const oepa = Number(row.oepa);
            if (Number.isFinite(oepa) && oepa > 0) {
                statsMap[key].sum += oepa;
                statsMap[key].count += 1;
            }
        }

        const procedures = Object.values(statsMap).map(s => ({
            desc: s.desc,
            code: s.code,
            avg_epa: s.count > 0 ? Number((s.sum / s.count).toFixed(2)) : 0,
            count: s.count,
            totalCount: s.totalCount,
        }));

        return NextResponse.json({ success: true, procedures });
    } catch (err) {
        console.error('[cohort-procedures]', err);
        return NextResponse.json({ success: false, message: 'Server error', error: (err as Error).message }, { status: 500 });
    }
}