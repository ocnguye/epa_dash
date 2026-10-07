import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { pool } from '@/lib/db';
import { requireUser, AuthError } from '@/lib/requireUser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROLES = ['trainee', 'attending', 'admin'];
const fail = (message: string, status: number) =>
  NextResponse.json({ success: false, message }, { status });

function handleError(err: any, label: string) {
  if (err instanceof AuthError) return fail(err.message, err.status);
  if (err?.code === 'ER_DUP_ENTRY') return fail('That profile already exists', 409);
  console.error(label, err?.message);
  return fail('Server error', 500);
}

// Everyone who has signed in and has (or had) at least one profile
export async function GET() {
  try {
    await requireUser(['admin']);
    const [rows] = await pool.execute(
      `SELECT s.sso_identity_id, s.email, s.display_name,
              l.disabled_at, u.user_id, u.role, u.username, u.first_name, u.last_name
       FROM sso_identities s
       JOIN user_sso_links l ON l.sso_identity_id = s.sso_identity_id
       JOIN users u ON u.user_id = l.user_id
       ORDER BY s.display_name, s.sso_identity_id,
                FIELD(u.role, 'trainee', 'attending', 'admin')`,
    );

    const byId = new Map<number, any>();
    for (const r of rows as any[]) {
      if (!byId.has(r.sso_identity_id)) {
        byId.set(r.sso_identity_id, {
          sso_identity_id: r.sso_identity_id,
          email: r.email,
          display_name: r.display_name,
          profiles: [],
        });
      }
      byId.get(r.sso_identity_id).profiles.push({
        user_id: r.user_id,
        role: r.role,
        username: r.username,
        first_name: r.first_name,
        last_name: r.last_name,
        active: r.disabled_at == null,
      });
    }
    return NextResponse.json({ success: true, people: [...byId.values()] });
  } catch (err) {
    return handleError(err, 'People GET error:');
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireUser(['admin']);
    const body = await req.json().catch(() => ({}));
    const identityId = Number(body?.identityId);
    if (!Number.isInteger(identityId)) return fail('Bad request', 400);

    const [existing] = await pool.execute(
      `SELECT u.user_id, u.role, u.username, u.first_name, u.last_name, l.disabled_at
       FROM user_sso_links l JOIN users u ON u.user_id = l.user_id
       WHERE l.sso_identity_id = ?`,
      [identityId],
    );
    const profiles = existing as any[];
    if (profiles.length === 0) return fail('Person not found', 404);

    // ── Add a role (new profile, or re-enable a disabled one) ────────────
    if (body.action === 'add_role') {
      const role = String(body?.role ?? '');
      if (!ROLES.includes(role)) return fail('Invalid role', 400);

      const sameRole = profiles.find((p) => p.role === role);
      if (sameRole) {
        if (sameRole.disabled_at == null) return fail(`They already have an active ${role} profile`, 409);
        await pool.execute(
          `UPDATE user_sso_links SET disabled_at = NULL WHERE sso_identity_id = ? AND user_id = ?`,
          [identityId, sameRole.user_id],
        );
        console.log(`ADMIN ENABLE: by user ${me.userId}, identity ${identityId} -> user ${sameRole.user_id} (${role})`);
        return NextResponse.json({ success: true, message: `${role} access re-enabled` });
      }

      const [idRows] = await pool.execute(
        `SELECT email FROM sso_identities WHERE sso_identity_id = ?`, [identityId]);
      const email = (idRows as any[])[0]?.email;
      const base = profiles[0]; // same person: reuse name and username
      const unusable = await bcrypt.hash(randomUUID(), 10);

      const conn = await pool.getConnection();
      let newId: number;
      try {
        await conn.beginTransaction();
        const [ins] = await conn.execute(
          `INSERT INTO users (first_name, last_name, username, password, role, email)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [base.first_name, base.last_name, base.username, unusable, role,
           email ? String(email).toLowerCase() : null],
        );
        newId = (ins as any).insertId;
        await conn.execute(
          `INSERT INTO user_sso_links (sso_identity_id, user_id, link_method) VALUES (?, ?, 'manual')`,
          [identityId, newId],
        );
        await conn.commit();
      } catch (e) {
        await conn.rollback().catch(() => {});
        throw e;
      } finally {
        conn.release();
      }

      console.log(`ADMIN ADD_ROLE: by user ${me.userId}, identity ${identityId} -> new user ${newId} (${role})`);
      return NextResponse.json({ success: true, message: `${role} access added` });
    }

    // ── Disable / enable one profile's access ────────────────────────────
    if (body.action === 'disable' || body.action === 'enable') {
      const userId = Number(body?.userId);
      const target = profiles.find((p) => p.user_id === userId);
      if (!target) return fail('Profile not found for this person', 404);

      if (body.action === 'disable') {
        if (userId === me.userId) {
          return fail('You can’t disable the profile you are signed in as. Switch to another profile first.', 409);
        }
        if (target.role === 'admin') {
          const [others] = await pool.execute(
            `SELECT 1 FROM user_sso_links l JOIN users u ON u.user_id = l.user_id
             WHERE l.disabled_at IS NULL AND u.role = 'admin' AND l.user_id <> ? LIMIT 1`,
            [userId],
          );
          if ((others as any[]).length === 0) return fail('That is the last active admin. Add another admin first.', 409);
        }
        await pool.execute(
          `UPDATE user_sso_links SET disabled_at = NOW()
           WHERE sso_identity_id = ? AND user_id = ? AND disabled_at IS NULL`,
          [identityId, userId],
        );
      } else {
        await pool.execute(
          `UPDATE user_sso_links SET disabled_at = NULL WHERE sso_identity_id = ? AND user_id = ?`,
          [identityId, userId],
        );
      }

      console.log(`ADMIN ${String(body.action).toUpperCase()}: by user ${me.userId}, identity ${identityId} -> user ${userId} (${target.role})`);
      return NextResponse.json({ success: true, message: `${target.role} access ${body.action}d` });
    }

    return fail('Unknown action', 400);
  } catch (err) {
    return handleError(err, 'People POST error:');
  }
}