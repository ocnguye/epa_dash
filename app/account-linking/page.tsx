import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireUser, AuthError } from '@/lib/requireUser';
import AdminLinkingPanel from '@/components/AdminLinkingPanel';

export default async function AccountLinkingPage() {
  try {
    await requireUser(['admin']);
  } catch (e) {
    if (e instanceof AuthError) redirect('/');
    throw e;
  }

  return (
    <main
      className="min-h-screen px-4 py-8"
      style={{ background: 'linear-gradient(135deg, #c8ceee 30%, #a7abde 100%)' }}
    >
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 rounded-2xl bg-white p-6 shadow">
          <Link href="/select-account" className="text-sm text-gray-500 hover:underline">
            ← Switch dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Account Linking</h1>
          <p className="text-gray-600">
            Connect Emory sign-ins to dashboard profiles, or create profiles for new users.
          </p>
        </div>
        <div className="rounded-2xl bg-white p-2 shadow">
          <AdminLinkingPanel />
        </div>
      </div>
    </main>
  );
}