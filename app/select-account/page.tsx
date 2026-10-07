import { redirect } from 'next/navigation';
import { pool } from '@/lib/db';
import { getSession } from '@/lib/session';
import AccountButton from '@/components/AccountButton';

// Rename tiles here (e.g. admin -> 'Attending Overview')
const ROLE_TITLE: Record<string, string> = {
  trainee: 'Trainee Dashboard',
  attending: 'Attending Dashboard',
  admin: 'Admin Dashboard',
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

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <h1 className="text-2xl font-semibold mb-2">Select a Dashboard</h1>
        <p className="text-gray-600 mb-6">Select the dashboard you would like to access.</p>

        <div className="space-y-3">
          {accounts.map((account) => (
            <AccountButton
              key={account.user_id}
              userId={account.user_id}
              title={ROLE_TITLE[account.role] ?? `${account.role} Dashboard`}
              subtitle={account.preferred_name || `${account.first_name} ${account.last_name}`}
            />
          ))}
        </div>

        {adminAccount && (
          <>
            <div className="mt-8 mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Admin tools
            </div>
            <AccountButton
              userId={adminAccount.user_id}
              title="Account Linking"
              subtitle="Connect Emory sign-ins to profiles, or create profiles for new users"
              destination="/account-linking"
            />
          </>
        )}
      </div>
    </main>
  );
}