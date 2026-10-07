// app/api/me/route.ts
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COLS = `u.user_id, u.username, u.role, u.pgy, u.pgy_note,
              u.first_name, u.last_name, u.preferred_name`;

export async function GET() {
  const s = await getSession();

  // Dev password session: no SSO identity in the cookie
  if (!s.identityId) {
    if (process.env.ALLOW_PASSWORD_LOGIN === 'true' && s.userId) {
      const [r] = await pool.execute(
        `SELECT ${COLS} FROM users u WHERE u.user_id = ? AND u.role IS NOT NULL`,
        [s.userId],
      );
      const u: any = (r as any[])[0];
      if (u) {
        return NextResponse.json({
          authenticated: true,
          activeUserId: u.user_id,
          user: u,
          username: u.username,
          role: u.role,
          accounts: [u],
        });
      }
    }
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  // SSO session: accounts this identity may act as
  const [rows] = await pool.execute(
    `SELECT ${COLS}
     FROM user_sso_links l JOIN users u ON u.user_id = l.user_id
     WHERE l.sso_identity_id = ? AND l.disabled_at IS NULL AND u.role IS NOT NULL
     ORDER BY u.role`,
    [s.identityId],
  );
  const accounts = rows as any[];
  let active = accounts.find(a => a.user_id === s.userId) ?? null;

  // The cookie's auth session must still be open
  if (active) {
    const [open] = await pool.execute(
      `SELECT 1 FROM auth_sessions
       WHERE auth_session_id = ? AND user_id = ? AND sso_identity_id = ? AND ended_at IS NULL`,
      [s.authSessionId ?? '', active.user_id, s.identityId],
    );
    if ((open as any[]).length === 0) active = null;
  }

  return NextResponse.json({
    authenticated: !!active,
    activeUserId: active?.user_id ?? null,
    user: active,
    username: active?.username,
    role: active?.role,
    accounts,
  });
}