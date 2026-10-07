import { redirect } from 'next/navigation';
import { pool } from '@/lib/db';
import { getSession } from '@/lib/session';
import AccountButton from '@/components/AccountButton';

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

  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-lg">
        <h1 className="text-2xl font-semibold mb-2">Select a Dashboard</h1>
        <p className="text-gray-600 mb-6">Select the dashboard you would like to access.</p>
        <div className="space-y-3">
          {accounts.map((account) => (
            <AccountButton key={account.user_id} account={account} />
          ))}
        </div>
      </div>
    </main>
  );
}