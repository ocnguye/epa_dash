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
      style={{
        minHeight: '100vh',
        padding: 20,
        boxSizing: 'border-box',
        background: 'linear-gradient(135deg, #c8ceee 30%, #a7abde 100%)',
        fontFamily: 'Ubuntu, sans-serif',
        color: '#111827',
      }}
    >
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Header */}
        <div style={{ background: '#fff', borderRadius: 16, padding: '20px 24px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
          <Link href="/select-account" style={{ fontSize: 13, fontWeight: 600, color: '#374151', textDecoration: 'none' }}>
            ← Switch dashboard
          </Link>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#000', margin: '6px 0 4px 0' }}>Account Linking</h1>
          <p style={{ fontSize: 15, color: '#374151', margin: 0 }}>
            Assign roles and create user profiles for Emory users who have signed in to the
            dashboard but can’t see anything yet.
          </p>

          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#374151' }}>
              How this works
            </summary>
            <div style={{ fontSize: 14, color: '#374151', marginTop: 8, lineHeight: 1.5 }}>
              <p style={{ margin: '0 0 6px 0' }}>
                People sign in with their Emory login (<strong>SSO</strong>). That proves who they
                are, but access comes from a <strong>profile</strong> with a role. Until an Emory
                sign-in is connected to a profile, the person sees “account not set up.”
              </p>
              <p style={{ margin: '0 0 6px 0' }}>
                Pick a person below, then <strong>connect</strong> them to an existing profile or{' '}
                <strong>create</strong> a new one. They get access the next time they sign in.
              </p>
              <p style={{ margin: 0 }}>
                <strong>Trainee</strong>: own EPA scores and reports. <strong>Attending</strong>:
                their trainees and reports. <strong>Admin</strong>: program-wide data and this
                tool. One person can have several profiles, so connect each one separately.
                Changes are logged.
              </p>
            </div>
          </details>
        </div>

        {/* The tool */}
        <AdminLinkingPanel />
      </div>
    </main>
  );
}