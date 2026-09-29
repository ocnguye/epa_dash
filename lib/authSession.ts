// lib/authSession.ts
import { randomUUID } from 'crypto';
import type { IronSession } from 'iron-session';
import { pool } from '@/lib/db';
import type { Role, SessionData } from '@/lib/session';

export async function startAuthSession(
  session: IronSession<SessionData>,
  identityId: number,
  user: { user_id: number; username: string; role: Role },
) {
  if (session.authSessionId) {
    await pool.execute(
      `UPDATE auth_sessions SET ended_at = NOW(), end_reason = 'switch'
       WHERE auth_session_id = ? AND ended_at IS NULL`,
      [session.authSessionId],
    );
  }
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO auth_sessions (auth_session_id, sso_identity_id, user_id) VALUES (?, ?, ?)`,
    [id, identityId, user.user_id],
  );
  session.identityId = identityId;
  session.userId = user.user_id;
  session.username = user.username;
  session.role = user.role;
  session.authSessionId = id;
  await session.save();
}