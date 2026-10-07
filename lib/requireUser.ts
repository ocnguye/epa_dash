import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getSession, type Role } from '@/lib/session';

export class AuthError extends Error {
  constructor(public status: 401 | 403) {
    super(status === 401 ? 'Unauthorized' : 'Forbidden');
  }
}

export interface AuthedUser {
  userId: number;
  username: string;
  role: Role;
  identityId: number;
  authSessionId: string;
}

export async function requireUser(allowed?: Role[]): Promise<AuthedUser> {
  const s = await getSession();

      if (!s.identityId && process.env.ALLOW_PASSWORD_LOGIN === 'true' && s.userId) {
      const [rows] = await pool.execute(
        `SELECT user_id, username, role FROM users WHERE user_id = ?`, [s.userId]);
      const u: any = (rows as any[])[0];
      if (!u?.role) throw new AuthError(401);
      if (allowed && !allowed.includes(u.role)) throw new AuthError(403);
      return { userId: u.user_id, username: u.username, role: u.role,
              identityId: 0, authSessionId: '' };
    }
    
  if (!s.userId || !s.identityId || !s.authSessionId) throw new AuthError(401);

  const [rows] = await pool.execute(
    `SELECT u.user_id, u.username, u.role
     FROM auth_sessions a
     JOIN user_sso_links l
       ON l.sso_identity_id = a.sso_identity_id
      AND l.user_id = a.user_id
      AND l.disabled_at IS NULL
     JOIN users u ON u.user_id = a.user_id
     WHERE a.auth_session_id = ? AND a.ended_at IS NULL
       AND a.sso_identity_id = ? AND a.user_id = ?`,
    [s.authSessionId, s.identityId, s.userId],
  );
  const u: any = (rows as any[])[0];
  if (!u?.role) throw new AuthError(401);
  if (allowed && !allowed.includes(u.role)) throw new AuthError(403);

  return {
    userId: u.user_id,
    username: u.username,
    role: u.role,
    identityId: s.identityId,
    authSessionId: s.authSessionId,
  };
}

// Wrapper so route files stay short.
export function withUser<C = unknown>(
  allowed: Role[] | undefined,
  handler: (me: AuthedUser, req: Request, ctx: C) => Promise<Response>,
) {
  return async (req: Request, ctx: C) => {
    try {
      return await handler(await requireUser(allowed), req, ctx);
    } catch (e) {
      if (e instanceof AuthError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }
  };
}