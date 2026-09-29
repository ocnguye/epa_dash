import { getIronSession, SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';

export type Role = 'attending' | 'trainee' | 'admin';

export interface SessionData {
  username?: string;
  role?: Role;
  identityId?: number;
  userId?: number;
  authSessionId?: string;
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET as string,
  cookieName: 'epa_session',
  ttl: 60 * 60 * 2, // 2 hours
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  },
};

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}