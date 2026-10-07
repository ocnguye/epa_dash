import { redirect } from 'next/navigation';
import { pool } from '@/lib/db';
import { getSession } from '@/lib/session';
import AccountButton from '@/components/AccountButton';
import SignOutButton from '@/components/SignOutButton';

// Rename tiles here (e.g. admin -> 'Attending Overview')
const ROLES: Record<
  string,
  { title: string; description: string; accent: 'blue' | 'green' | 'purple'; icon: 'trainee' | 'attending' | 'admin' }
> = {
  trainee:   { title: 'Trainee Dashboard',   description: 'Your EPA scores and reports',               accent: 'blue',   icon: 'trainee' },
  attending: { title: 'Attending Dashboard', description: 'Your trainees and the reports you review',  accent: 'green',  icon: 'attending' },
  admin:     { title: 'Admin Dashboard',     description: 'Program-wide EPA provision overview',       accent: 'purple', icon: 'admin' },
};

export default async function SelectAccountPage() {
  const session = await getSession();

  if (!session.identityId) {
    redirect('/');
  }

  const [rows] = await pool.execute(
    `SELECT u.user_id, u.first_name, u.last_name, u.preferred_name, u.username, u.role
     FROM user_sso_links l
     JOIN users u ON u.user_id = l.user_id
     WHERE l.sso_identity_id = ?
       AND l.disabled_at IS NULL
     ORDER BY FIELD(u.role, 'trainee', 'attending', 'admin')`,
    [session.identityId]
  );

  const accounts = rows as any[];

  if (accounts.length === 0) {
    redirect('/?error=not_authorized');
  }

  const adminAccount = accounts.find((a) => a.role === 'admin');
  const first = accounts[0];
  const greetingName = (first.preferred_name || first.first_name || '').trim();

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 16px',
        boxSizing: 'border-box',
        background: 'linear-gradient(135deg, #c8ceee 30%, #a7abde 100%)',
        fontFamily: 'Ubuntu, sans-serif',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 480,
          background: '#fff',
          borderRadius: 16,
          padding: 32,
          boxSizing: 'border-box',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        }}
      >
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#22223b', margin: '0 0 8px 0' }}>
          {greetingName ? `Welcome, ${greetingName}` : 'Welcome'}
        </h1>
        <p style={{ fontSize: 16, color: '#4b5563', margin: '0 0 24px 0' }}>
          {accounts.length > 1
            ? 'You have access to more than one dashboard. Choose the one you would like to open.'
            : 'Choose the dashboard you would like to open.'}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {accounts.map((account) => {
            const r = ROLES[account.role];
            return (
              <AccountButton
                key={account.user_id}
                userId={account.user_id}
                title={r?.title ?? `${account.role} Dashboard`}
                subtitle={r?.description}
                accent={r?.accent ?? 'blue'}
                icon={r?.icon ?? 'trainee'}
              />
            );
          })}
        </div>

        {adminAccount && (
          <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid #e5e7eb' }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: 0.6,
                textTransform: 'uppercase',
                color: '#4b5563',
                marginBottom: 10,
              }}
            >
              Admin tools
            </div>
            <AccountButton
              userId={adminAccount.user_id}
              title="Account Linking"
              subtitle="Give new Emory users access by assigning roles and creating profiles"
              destination="/account-linking"
              accent="yellow"
              icon="tool"
            />
          </div>
        )}

        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}