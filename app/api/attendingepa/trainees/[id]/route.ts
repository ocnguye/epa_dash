import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
import { resolveProcedureAliasFromQuery, getProcTypesByIds } from '@/lib/procAliasLookup';

const getConnection = async () => mysql.createConnection({
    host: process.env.AWS_RDS_HOST,
    user: process.env.AWS_RDS_USER,
    password: process.env.AWS_RDS_PWD || process.env.AWS_RDS_PASS,
    database: process.env.AWS_RDS_DB || 'powerscribe',
});

export async function GET(req: NextRequest, context: any) {
    const { params } = context || {};
    const resolvedParams = params && typeof (params as any).then === 'function' ? await params : params;
    try {
        const username = req.cookies.get('username')?.value;
        if (!username) return NextResponse.json({ success: false, message: 'Not authenticated' }, { status: 401 });

        const connection = await getConnection();

        const [authRows] = await connection.execute('SELECT role, user_id FROM users WHERE username = ?', [username]);
        const auth = Array.isArray(authRows) && (authRows as any)[0] ? (authRows as any)[0] : null;
        if (!auth) {
            await connection.end();
            return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
        }
        if (String(auth.role) !== 'attending') {
            await connection.end();
            return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
        }

        const traineeId = Number(resolvedParams?.id);
        if (!Number.isFinite(traineeId) || traineeId <= 0) {
            await connection.end();
            return NextResponse.json({ success: false, message: 'Invalid trainee id' }, { status: 400 });
        }

        // Optional free-text search, e.g. /api/attendingepa/trainee/14?q=g%20tube
        const { searchParams } = new URL(req.url);
        const q = searchParams.get('q')?.trim() || null;

        // Optional follow-up: after the attending picks from a disambiguation
        // prompt, the client resubmits with explicit proc_type_id(s) instead of
        // re-sending the ambiguous free-text query, e.g. ?proc_type_ids=5,9
        const procTypeIdsParam = searchParams.get('proc_type_ids');
        const requestedProcTypeIds = procTypeIdsParam
            ? procTypeIdsParam.split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0)
            : [];

        const [userRows] = await connection.execute(
            `SELECT user_id, username, first_name, last_name, preferred_name, pgy, role FROM users WHERE user_id = ?`,
            [traineeId]
        );
        const rawUser = Array.isArray(userRows) && (userRows as any)[0] ? (userRows as any)[0] : null;
        if (!rawUser) {
            await connection.end();
            return NextResponse.json({ success: false, message: 'Trainee not found' }, { status: 404 });
        }

        const user = {
            user_id: Number(rawUser.user_id),
            username: rawUser.username,
            first_name: rawUser.first_name ?? null,
            last_name: rawUser.last_name ?? null,
            preferred_name: rawUser.preferred_name ? String(rawUser.preferred_name).trim() : null,
            pgy: typeof rawUser.pgy !== 'undefined' && rawUser.pgy !== null ? Number(rawUser.pgy) : null,
            role: rawUser.role ?? null,
        } as any;

        // ── Resolve `q` against the alias table before touching reports ──────
        //
        // Replaces the old MATCH(ContentText) AGAINST(...) fallback entirely.
        // ContentText is free dictation text and its FULLTEXT relevance scoring
        // surfaced unrelated procedures (e.g. "g tube" matching an adrenal vein
        // sampling report on incidental token overlap). Alias lookups are exact
        // and backed by the curated proc_aliases/proc_type_aliases tables, so
        // they replace that fuzzy fallback with a precise one, with an explicit
        // disambiguation step when an alias is genuinely ambiguous (e.g. "para"
        // -> CT/US/IR paracentesis) rather than silently picking or merging.
        //
        // canonicalProcDescs ends up holding the proc_desc value(s) to match
        // ProcedureDescList against. If alias resolution finds nothing, we fall
        // back to matching the raw query text directly against
        // ProcedureDescList/ProcedureCodeList — still no ContentText involved.
        let canonicalProcDescs: string[] = [];
        let matchedViaAlias = false;

        if (requestedProcTypeIds.length > 0) {
            // Attending already disambiguated in a prior request.
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
                // Short-circuit: don't run the procedure query at all yet — ask
                // the attending to pick first, same UX pattern as an ambiguous
                // trainee-name resolution.
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

        // searchClause now only ever touches ProcedureDescList / ProcedureCodeList.
        // Two shapes:
        //   - alias resolved (one or more canonical proc_desc values): exact-ish
        //     match against those specific descriptions.
        //   - no alias match: fall back to a direct LIKE on the raw query text.
        let searchClause = '';
        let descMatchSelect = '';
        const procedureParams: any[] = [];

        if (matchedViaAlias && canonicalProcDescs.length > 0) {
            const descPlaceholders = canonicalProcDescs.map(() => '?').join(', ');
            searchClause = `AND r.ProcedureDescList IN (${descPlaceholders})`;
            descMatchSelect = `1 AS desc_match,`;
        } else if (q) {
            searchClause = `AND (r.ProcedureDescList LIKE ? OR r.ProcedureCodeList LIKE ?)`;
            descMatchSelect = `CASE WHEN r.ProcedureDescList LIKE ? OR r.ProcedureCodeList LIKE ? THEN 1 ELSE 0 END AS desc_match,`;
        }

        /// Actual order of `?` in the SQL text below, top to bottom:
        // 1-N. canonicalProcDescs IN (...) for descMatchSelect [alias path], OR
        //      desc_match CASE q/q                              [fallback path]
        // next. seek_feedback subquery 1  (traineeId)
        // next. seek_feedback subquery 2  (traineeId)
        // next. WHERE rp.user_id          (traineeId)
        // next. searchClause params       (canonicalProcDescs[] OR q, q)

        if (matchedViaAlias && canonicalProcDescs.length > 0) {
        // descMatchSelect has no IN() — it's hardcoded as `1 AS desc_match` — no params needed
        } else if (q) {
            procedureParams.push(`%${q}%`, `%${q}%`); // descMatchSelect CASE
        }
        procedureParams.push(traineeId, traineeId, traineeId);
        if (matchedViaAlias && canonicalProcDescs.length > 0) {
            procedureParams.push(...canonicalProcDescs); // searchClause IN(...) — spread, not array
        } else if (q) {
            procedureParams.push(`%${q}%`, `%${q}%`); // searchClause LIKE/LIKE
        }

        const [procedures] = await connection.execute(
            `SELECT
                r.ReportID AS report_id,
                DATE_FORMAT(r.CreateDate, '%Y-%m-%d') AS create_date,
                r.ProcedureDescList AS proc_desc,
                REPLACE(NULLIF(TRIM(r.ProcedureCodeList), ''), ';', ', ') AS proc_code,
                es.epa_score AS oepa,
                pt.complexity AS complexity,
                r.Attending AS raw_attending,
                r.Trainee AS raw_trainee,
                CONCAT(u_tr.first_name, ' ', u_tr.last_name) AS trainee_name,
                ${descMatchSelect}
                (
                    SELECT GROUP_CONCAT(CONCAT(u_att.first_name, ' ', u_att.last_name) SEPARATOR ', ')
                    FROM report_participants rp_att
                    JOIN users u_att ON u_att.user_id = rp_att.user_id
                    WHERE rp_att.report_id = r.ReportID AND rp_att.role = 'attending'
                ) AS attending_name,
                (
                    CASE
                        WHEN (SELECT SUM(fr.status = 'feedback_requested') FROM feedback_requests fr
                            WHERE fr.report_id = r.ReportID AND fr.trainee_user_id = ?) > 0
                            THEN 'feedback_requested'
                        WHEN (SELECT SUM(fr.status = 'discussed') FROM feedback_requests fr
                            WHERE fr.report_id = r.ReportID AND fr.trainee_user_id = ?) > 0
                            THEN 'discussed'
                        ELSE 'not_required'
                    END
                ) AS seek_feedback
            FROM report_participants rp
            JOIN reports r ON r.ReportID = rp.report_id
            JOIN users u_tr ON u_tr.user_id = rp.user_id
            LEFT JOIN epa_scores es ON es.report_participant_id = rp.id
            -- complexity now lives on proc_types, not reports — join by the same
            -- normalized-text match the import script used (ProcedureCodeList
            -- isn't a reliable join key yet, so this stays a text match rather
            -- than an id join).
            LEFT JOIN proc_types pt ON UPPER(TRIM(r.ProcedureDescList)) = UPPER(TRIM(pt.proc_desc))
            WHERE rp.user_id = ?
            AND rp.role = 'trainee'
            ${searchClause}
            ORDER BY r.CreateDate DESC`,
            procedureParams
        );

        // Stats — unchanged, intentionally NOT filtered by q.
        // The chatbot's drilldown numbers (avg/trend) come from the filtered `procedures`
        // array client-side; this `stats` block is the trainee's overall summary and should
        // stay independent of whatever search phrase was typed.
        const [statsRows] = await connection.execute(
            `SELECT
                COALESCE(ROUND(AVG(es_main.epa_score), 2), 0) AS avg_epa,
                COUNT(CASE WHEN MONTH(r.CreateDate) = MONTH(CURRENT_DATE()) AND YEAR(r.CreateDate) = YEAR(CURRENT_DATE()) THEN 1 END) AS procedures,
                COUNT(DISTINCT rp_main.report_id) AS total_reports,
                COALESCE((SELECT COUNT(*) FROM feedback_requests fr WHERE fr.trainee_user_id = ? AND fr.status = 'feedback_requested'), 0) AS feedback_requested,
                COALESCE((SELECT COUNT(*) FROM feedback_requests fr WHERE fr.trainee_user_id = ? AND fr.status = 'discussed'), 0) AS feedback_discussed
            FROM report_participants rp_main
            JOIN reports r ON r.ReportID = rp_main.report_id
            LEFT JOIN epa_scores es_main ON es_main.report_participant_id = rp_main.id
            WHERE rp_main.user_id = ?
              AND rp_main.role = 'trainee'`,
            [traineeId, traineeId, traineeId]
        ) as [any[], any];

        const stats = (statsRows && statsRows[0]) || {};
        const formattedStats = {
            avg_epa: Number(stats.avg_epa) || 0,
            procedures: Number(stats.procedures) || 0,
            feedback_requested: Number(stats.feedback_requested) || 0,
            feedback_discussed: Number(stats.feedback_discussed) || 0,
            total_reports: Number(stats.total_reports) || 0,
        };

        await connection.end();

        return NextResponse.json({ success: true, user, procedures, stats: formattedStats });
    } catch (err) {
        console.error('ROUTE ERROR:', err);  // add this line
        return NextResponse.json({ success: false, message: 'Server error', error: (err as Error).message }, { status: 500 });
    }
}