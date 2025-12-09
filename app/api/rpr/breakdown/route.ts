import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';

export async function GET(req: NextRequest) {
  let connection: mysql.Connection | null = null;

  try {
    const username = req.cookies.get('username')?.value;
    if (!username)
      return NextResponse.json(
        { success: false, message: "Not authenticated" },
        { status: 401 }
      );

    connection = await mysql.createConnection({
      host: process.env.AWS_RDS_HOST,
      user: process.env.AWS_RDS_USER,
      password: process.env.AWS_RDS_PWD || process.env.AWS_RDS_PASS,
      database: process.env.AWS_RDS_DB || "powerscribe",
    });

    // Parse optional score query param (1-4). If omitted, treat as ALL (null).
    const scoreParam = req.nextUrl.searchParams.get("score");
    const score = scoreParam ? parseInt(scoreParam, 10) : null;
    if (score !== null && (Number.isNaN(score) || score < 1 || score > 4))
      return NextResponse.json(
        { success: false, message: "Invalid score parameter; must be 1–4" },
        { status: 400 }
      );

    const [userRows] = await connection.execute(
      `SELECT user_id, first_name, last_name FROM users WHERE username = ? LIMIT 1`,
      [username]
    );

    if (!Array.isArray(userRows) || (userRows as any).length === 0)
      return NextResponse.json(
        { success: false, message: "User not found" },
        { status: 404 }
      );

  const userId = Number((userRows as any)[0].user_id);
  const firstName = (userRows as any)[0].first_name || '';
  const lastName = (userRows as any)[0].last_name || '';

    const gb = (req.nextUrl.searchParams.get("groupBy") || "").toLowerCase();

    const groupColumnMap: Record<string, string> = {
      "procedure_name": "ProcedureName",
      "modality": "Modality",
      "patient_class": "PatientClass",
    };

    const column = groupColumnMap[gb] || "ProcedureName";

    // Build RPR condition: when score is provided we parameterize the pattern,
    // otherwise use a no-op condition so disagree_count becomes COUNT(*).
    const hasRprCond = `(r.rpr_number_value IS NOT NULL OR (r.rpr_number_raw IS NOT NULL AND TRIM(r.rpr_number_raw) <> ''))`;
    let scoreConditionSQL = '1=1';
    const scoreParams: any[] = [];
    if (score !== null) {
      scoreConditionSQL = `(r.rpr_number_value = ? OR UPPER(COALESCE(r.rpr_number_raw, '')) REGEXP ?)`;
      scoreParams.push(score);
      scoreParams.push(`RPR[[:space:]]*${score}|RPR${score}|RPR-${score}`);
    }

    // Strictly require the joined user to match the logged-in user so we only
    // return groups derived from that user's reports. (No fallback name matching.)
    const whereClauses: string[] = ['u.user_id = ?', hasRprCond];
    const params: any[] = [];

    // Decide whether the dataset itself should be restricted to the requested
    // score. When score is provided we add the score condition to the WHERE
    // clause and set disagree_count = COUNT(*) (since all rows are that score).
    // When score is omitted we keep the broader dataset and compute disagree_count
    // with SUM(CASE WHEN ... ) which requires the score placeholders.
    let sumExpr = `SUM(CASE WHEN ${scoreConditionSQL} THEN 1 ELSE 0 END) AS disagree_count`;
    if (score !== null) {
      whereClauses.push(scoreConditionSQL);
      // When the WHERE clause lists `u.user_id = ?` first, the userId
      // placeholder must appear before the score placeholders in the
      // params array. Push userId first, then any score params.
      params.push(userId);
      // score params are used once (in WHERE)
      params.push(...scoreParams);
      // dataset restricted => disagree_count should equal COUNT(*)
      sumExpr = 'COUNT(*) AS disagree_count';
    } else {
      // score omitted => SUM(...) used and score placeholders must be included
      // before userId in params (so add them now)
      if (scoreParams.length) params.push(...scoreParams);
    }

  // If we didn't already push userId (score branch already did), push it now
  if (score === null) params.push(userId);

    const sql = `
      SELECT
        COALESCE(r.${column}, 'Unspecified') AS grp,
        COUNT(*) AS total_with_rpr,
        ${sumExpr}
      FROM rpr_reports r
      LEFT JOIN users u ON r.trainee_id = u.user_id
      WHERE ${whereClauses.join(' AND ')}
      GROUP BY grp
      ORDER BY total_with_rpr DESC
      LIMIT 100
    `;

    const [rows] = await connection.execute(sql, params);

    const groups = (rows as any[]).map((r) => {
      const total = Number(r.total_with_rpr) || 0;
      const disagree = Number(r.disagree_count) || 0;

      return {
        group: r.grp,
        total_with_rpr: total,
        disagree_count: disagree,
        disagree_percent:
          total > 0 ? Number(((disagree / total) * 100).toFixed(2)) : 0,
      };
    });

    return NextResponse.json({ success: true, data: { groups } });
  } catch (err: any) {
    console.error("RPR breakdown error", err);
    return NextResponse.json(
      { success: false, message: "Server error", error: err.message },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}
