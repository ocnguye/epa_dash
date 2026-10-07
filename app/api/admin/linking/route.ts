import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { pool } from '@/lib/db';
import { requireUser, AuthError } from '@/lib/requireUser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fail = (message: string, status: number) =>
  NextResponse.json({ success: false, message }, { status });

const ROLES = ['trainee', 'attending', 'admin'];

function handleError(err: any, label: string) {
  if (err instanceof AuthError) return fail(err.message, err.status);
  if (err?.code === 'ER_DUP_ENTRY') return fail('That username/role or link already exists', 409);
  console.error(label, err?.message);
  return fail('Server error', 500);
}

// Identities with no active link, and users with no active link
export async function GET() {
  try {
        await requireUser(['admin']);

    const [identities] = await pool.execute(
      `SELECT s.sso_identity_id, s.email, s.display_name, s.netid, s.first_login_at, s.last_login_at
       FROM sso_identities s
       WHERE NOT EXISTS (
         SELECT 1 FROM user_sso_links l
         WHERE l.sso_identity_id = s.sso_identity_id AND l.disabled_at IS NULL
       )
       ORDER BY s.last_login_at DESC`,
    );

    const [users] = await pool.execute(
      `SELECT u.user_id, u.first_name, u.last_name, u.preferred_name, u.username, u.role, u.email
       FROM users u
       WHERE u.role IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM user_sso_links l
           WHERE l.user_id = u.user_id AND l.disabled_at IS NULL
         )
       ORDER BY u.last_name, u.first_name, u.role`,
    );

    return NextResponse.json({ success: true, identities, users });
  } catch (err) {
    return handleError(err, 'Linking GET error:');
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireUser(['admin']);
    const body = await req.json().catch(() => ({}));

    const identityId = Number(body?.identityId);
    if (!Number.isInteger(identityId)) return fail('Bad request', 400);

    const [idRows] = await pool.execute(
      `SELECT sso_identity_id, email FROM sso_identities WHERE sso_identity_id = ?`,
      [identityId],
    );
    const ident: any = (idRows as any[])[0];
    if (!ident) return fail('Identity not found', 404);

    // ── Link an existing profile ─────────────────────────────────────────
    if (body.action === 'link') {
      const userId = Number(body?.userId);
      if (!Number.isInteger(userId)) return fail('Bad request', 400);

      const [uRows] = await pool.execute(
        `SELECT user_id, email, role FROM users WHERE user_id = ?`, [userId]);
      const u: any = (uRows as any[])[0];
      if (!u) return fail('User not found', 404);

      const [active] = await pool.execute(
        `SELECT 1 FROM user_sso_links WHERE user_id = ? AND disabled_at IS NULL`, [userId]);
      if ((active as any[]).length > 0) return fail('That profile is already linked', 409);

      // Re-enable an old disabled link for this pair if there is one, else insert
      const [upd] = await pool.execute(
        `UPDATE user_sso_links SET disabled_at = NULL
         WHERE sso_identity_id = ? AND user_id = ? AND disabled_at IS NOT NULL`,
        [identityId, userId],
      );
      if (!(upd as any).affectedRows) {
        await pool.execute(
          `INSERT INTO user_sso_links (sso_identity_id, user_id, link_method) VALUES (?, ?, 'manual')`,
          [identityId, userId],
        );
      }

      // Save the email on the profile so later logins can auto-link
      if (ident.email) {
        await pool.execute(`UPDATE users SET email = ? WHERE user_id = ? AND email IS NULL`,
          [String(ident.email).toLowerCase(), userId]);
      }

      console.log(`ADMIN LINK: by user ${admin.userId}, identity ${identityId} -> user ${userId} (${u.role})`);
      return NextResponse.json({ success: true, message: 'Profile linked' });
    }

    // ── Create a new profile and link it ─────────────────────────────────
    if (body.action === 'create') {
      const role = String(body?.role ?? '');
      const first = String(body?.first_name ?? '').trim();
      const last = String(body?.last_name ?? '').trim();
      const username = String(body?.username ?? '').trim();

      if (!ROLES.includes(role)) return fail('Invalid role', 400);
      if (!first || !last || first.length > 100 || last.length > 100) return fail('Invalid name', 400);
      if (!username || username.length > 100) return fail('Invalid username', 400);

      // SSO-only profile: random unusable password so the column is never empty
      const unusable = await bcrypt.hash(randomUUID(), 10);

      const conn = await pool.getConnection();
      let newId: number;
      try {
        await conn.beginTransaction();
        const [ins] = await conn.execute(
          `INSERT INTO users (first_name, last_name, username, password, role, email)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [first, last, username, unusable, role, ident.email ? String(ident.email).toLowerCase() : null],
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

      console.log(`ADMIN CREATE: by user ${admin.userId}, identity ${identityId} -> new user ${newId} (${role})`);
      return NextResponse.json({ success: true, message: 'Profile created and linked' });
    }

    return fail('Unknown action', 400);
  } catch (err) {
    return handleError(err, 'Linking POST error:');
  }
}