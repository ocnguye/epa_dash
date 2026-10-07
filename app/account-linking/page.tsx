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
      className="min-h-screen px-4 py-8 text-gray-900"
      style={{ background: 'linear-gradient(135deg, #c8ceee 30%, #a7abde 100%)' }}
    >
      <div className="mx-auto max-w-5xl space-y-4">
        {/* Header */}
        <div className="rounded-2xl bg-white p-6 shadow">
          <Link href="/select-account" className="text-sm font-medium text-blue-700 hover:underline">
            ← Switch dashboard
          </Link>
          <h1 className="mt-2 text-3xl font-bold text-gray-900">Account Linking</h1>
          <p className="mt-2 text-base text-gray-800">
            Use this tool to give new people access to the dashboard. Assign roles and create
            user profiles for Emory users who have signed in but do not have a profile yet, or
            connect them to a profile that already exists.
          </p>
        </div>

        {/* Plain-language explainer */}
        <div className="rounded-2xl bg-white p-6 shadow">
          <h2 className="text-xl font-semibold text-gray-900">How this works</h2>
          <p className="mt-2 text-base text-gray-800">
            Everyone signs in with their Emory login (this is called <strong>SSO</strong>, or
            single sign-on). Signing in proves who they are, but it does not decide what they
            can see. What they can see depends on their <strong>profile</strong>, which has a
            role. A person is only let into the dashboard once their Emory sign-in is
            connected to at least one profile.
          </p>

          <ol className="mt-4 list-decimal space-y-2 pl-6 text-base text-gray-800">
            <li>
              A new person signs in with Emory for the first time. If we cannot match them
              automatically, they see a message that their account is not set up yet, and they
              appear in the <strong>“Awaiting profile setup”</strong> list below.
            </li>
            <li>
              You select that person and either <strong>connect them to an existing
              profile</strong> or <strong>create a new profile</strong> with a role.
            </li>
            <li>
              The next time they sign in with Emory, they will see the dashboard (or
              dashboards) that match their profile.
            </li>
          </ol>

          <h3 className="mt-5 text-lg font-semibold text-gray-900">What the roles mean</h3>
          <ul className="mt-2 space-y-1 text-base text-gray-800">
            <li><strong>Trainee:</strong> sees their own EPA scores and reports.</li>
            <li><strong>Attending:</strong> sees the trainees and reports they work with.</li>
            <li>
              <strong>Admin:</strong> sees program-wide data and can use this tool. Only give
              this to people who should be able to grant access to others.
            </li>
          </ul>

          <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-base text-amber-900">
            One person can have more than one profile (for example, a trainee who is also an
            admin). Connect each profile separately. Every change you make here is recorded.
          </p>
        </div>

        {/* The tool */}
        <div className="rounded-2xl bg-white p-6 shadow">
          <AdminLinkingPanel />
        </div>
      </div>
    </main>
  );
}