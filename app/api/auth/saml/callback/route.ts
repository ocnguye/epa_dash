import { NextRequest, NextResponse } from 'next/server';
import { getSaml } from '@/lib/saml';
import { pool } from '@/lib/db';
import { getSession } from '@/lib/session';
import { startAuthSession } from '@/lib/authSession';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const go = (path: string) => NextResponse.redirect(`${process.env.BASE_URL}${path}`, 303);

const attr = (profile: any, name?: string): string | undefined => {
  if (!name) return undefined;
  const v = profile?.attributes?.[name] ?? profile?.[name];
  const s = Array.isArray(v) ? v[0] : v;
  return s == null || String(s).trim() === '' ? undefined : String(s).trim();
};

const findUnclaimed = async (col: 'username' | 'email', val: string) => {
  const [r] = await pool.execute(
    `SELECT u.user_id, u.username, u.role FROM users u
     LEFT JOIN user_sso_links l ON l.user_id = u.user_id
     WHERE LOWER(u.${col}) = ? AND l.link_id IS NULL`,
    [val],
  );
  return r as any[];
};

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const samlResponse = form.get('SAMLResponse');
    if (typeof samlResponse !== 'string') return go('/?error=sso_failed');

    const { profile } = await getSaml().validatePostResponseAsync({ SAMLResponse: samlResponse });
    if (!profile) return go('/?error=sso_failed');

    const isPersistent = profile.nameIDFormat?.endsWith(':persistent');
    const subject =
    attr(profile, process.env.SAML_SUBJECT_ATTR) ??
    (isPersistent ? profile.nameID : undefined);
    const uid = attr(profile, process.env.SAML_UID_ATTR)?.toLowerCase().replace(/@.*$/, '');
    const email = attr(profile, process.env.SAML_EMAIL_ATTR)?.toLowerCase();
    const displayName = attr(profile, process.env.SAML_NAME_ATTR);

    if (!subject) {
      console.error('SAML: subject attribute not released');
      return go('/?error=sso_failed');
    }

    // 1. upsert identity
    await pool.execute(
      `INSERT INTO sso_identities (issuer, subject, netid, email, display_name, first_login_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         netid = COALESCE(VALUES(netid), netid),
         email = COALESCE(VALUES(email), email),
         display_name = COALESCE(VALUES(display_name), display_name),
         last_login_at = NOW()`,
      [profile.issuer, subject, uid ?? null, email ?? null, displayName ?? null],
    );
    const [idRows] = await pool.execute(
      `SELECT sso_identity_id FROM sso_identities WHERE issuer = ? AND subject = ?`,
      [profile.issuer, subject],
    );
    const identityId: number = (idRows as any[])[0].sso_identity_id;

    // 2. active links
    const [linkRows] = await pool.execute(
      `SELECT u.user_id, u.username, u.role
       FROM user_sso_links l JOIN users u ON u.user_id = l.user_id
       WHERE l.sso_identity_id = ? AND l.disabled_at IS NULL
       ORDER BY u.role`,
      [identityId],
    );
    const links = linkRows as any[];

    // 3. first-login auto-match (only when nothing is linked yet)
    const [everLinked] = await pool.execute(
        `SELECT 1 FROM user_sso_links WHERE sso_identity_id = ? LIMIT 1`, [identityId]);
    if (links.length === 0 && (everLinked as any[]).length === 0) {
      let method: 'netid_match' | 'email_match' = 'netid_match';
      let cands = uid ? await findUnclaimed('username', uid) : [];
      if (cands.length === 0 && email && process.env.SSO_AUTOLINK_EMAIL === 'true') {
        cands = await findUnclaimed('email', email);
        method = 'email_match';
      }
      if (cands.length === 1) {
        await pool.execute(
          `INSERT INTO user_sso_links (sso_identity_id, user_id, link_method) VALUES (?, ?, ?)`,
          [identityId, cands[0].user_id, method],
        );
        links.push(cands[0]);
      }
    }

    // 4. route
    const session = await getSession();
    if (links.length === 1) {
    await startAuthSession(session, identityId, links[0]);
    return go('/post-login');
    }

    if (session.authSessionId) {
    await pool.execute(
        `UPDATE auth_sessions SET ended_at = NOW(), end_reason = 'switch'
        WHERE auth_session_id = ? AND ended_at IS NULL`,
        [session.authSessionId],
    );
    }
    session.identityId = identityId;
    session.userId = undefined;
    session.username = undefined;
    session.role = undefined;
    session.authSessionId = undefined;
    await session.save();
    return go(links.length > 1 ? '/select-account' : '/?error=not_authorized');
  } catch (err) {
    console.error('SAML callback error:', (err as Error).message);
    return go('/?error=sso_failed');
  }
}