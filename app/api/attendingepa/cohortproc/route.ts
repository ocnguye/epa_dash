import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
import { resolveProcedureAliasFromQuery, getProcTypesByIds } from '@/lib/procAliasLookup';

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

        // Optional: same alias-aware narrowing as the trainee-detail route, so
        // a colloquial query ("para", "g tube") can scope the cohort breakdown
        // server-side instead of always returning every procedure and relying
        // on filterCohortByPhrase client-side. Existing callers that omit `q`
        // get the original unscoped behavior, unchanged.
        const q = searchParams.get('q')?.trim() || null;
        const procTypeIdsParam = searchParams.get('proc_type_ids');
        const requestedProcTypeIds = procTypeIdsParam
            ? procTypeIdsParam.split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0)
            : [];

        let canonicalProcDescs: string[] = [];
        let matchedViaAlias = false;

        if (requestedProcTypeIds.length > 0) {
            const picked = await getProcTypesByIds(connection, requestedProcTypeIds);
            if (picked.length === 0) {
                await connection.end();
                return NextResponse.json({ success: false, message: 'No matching procedures for the given proc_type_ids' }, { status: 400 });
            }
            canonicalProcDescs = picked.map(p => p.proc_desc);
            matchedViaAlias = true;
        } else if (q) {
            const aliasResolution = await resolveProcedureAliasFromQuery(connection, q);

            if (aliasResolution.ambiguous.length > 0) {
                await connection.end();
                return NextResponse.json({
                    success: true,
                    disambiguation: {
                        query: q,
                        matchedAlias: aliasResolution.matchedAlias,
                        candidates: aliasResolution.ambiguous.map(m => ({
                            proc_type_id: m.procedure.proc_type_id,
                            proc_desc: m.procedure.proc_desc,
                            proc_code: m.procedure.proc_code,
                            proc_cat: m.procedure.proc_cat,
                        })),
                    },
                });
            }

            if (aliasResolution.resolved) {
                canonicalProcDescs = aliasResolution.resolved.map(p => p.proc_desc);
                matchedViaAlias = true;
            }
        }

        // Scope clause: only ever ProcedureDescList / ProcedureCodeList — no
        // ContentText, matching how this endpoint already behaved before any
        // of this change. Alias-resolved queries scope to the exact canonical
        // description(s); an unresolved free-text query falls back to LIKE
        // against the same two columns the import script populated.
        let scopeClause = '';
        const scopeParams: any[] = [];

        if (matchedViaAlias && canonicalProcDescs.length > 0) {
            const placeholders = canonicalProcDescs.map(() => '?').join(', ');
            scopeClause = `AND r.ProcedureDescList IN (${placeholders})`;
            scopeParams.push(...canonicalProcDescs);
        } else if (q) {
            scopeClause = `AND (r.ProcedureDescList LIKE ? OR r.ProcedureCodeList LIKE ?)`;
            scopeParams.push(`%${q}%`, `%${q}%`);
        }

        // Mirror the exact same EPA score subquery used in the trainee drill-down.
        // complexity now comes from proc_types (procedure-level), not r.complexity
        // (report-level) — joined the same normalized-text way the trainee-detail
        // route does, since ProcedureCodeList isn't a reliable join key yet.
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
                pt.complexity AS complexity,
                u.pgy
            FROM reports r
            JOIN users u ON (
                r.trainee = u.user_id
                OR r.trainee = CONCAT(u.first_name, ' ', u.last_name)
                OR r.trainee = u.username
            )
            LEFT JOIN proc_types pt ON UPPER(TRIM(r.ProcedureDescList)) = UPPER(TRIM(pt.proc_desc))
            WHERE u.role = 'trainee'
              ${pgy !== null ? 'AND u.pgy = ?' : ''}
              ${scopeClause}
        `;
        const params: any[] = [
            ...(pgy !== null ? [pgy] : []),
            ...scopeParams,
        ];

        const [rows] = await connection.execute(query, params) as any[];
        await connection.end();

        // Aggregate per procedure — same logic as the component's useMemo
        const statsMap: Record<string, { desc: string; code: string; complexity: number | null; sum: number; count: number; totalCount: number }> = {};

        for (const row of rows) {
            const desc = row.proc_desc ? String(row.proc_desc).trim() : '';
            const code = row.proc_code ? String(row.proc_code).trim() : '';
            const key = desc || code || 'Unknown';

            if (!statsMap[key]) {
                statsMap[key] = {
                    desc: desc || code || 'Unknown',
                    code,
                    complexity: row.complexity !== null && typeof row.complexity !== 'undefined' ? Number(row.complexity) : null,
                    sum: 0,
                    count: 0,
                    totalCount: 0,
                };
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
            complexity: s.complexity,
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