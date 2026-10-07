'use client';

import { useRouter } from 'next/navigation';

export default function SignOutButton() {
  const router = useRouter();

  return (
    <button
      onClick={async () => {
        try { await fetch('/api/logout', { method: 'POST' }); }
        finally { router.push('/'); }
      }}
      style={{
        background: 'transparent',
        border: 'none',
        color: '#4b5563',
        fontSize: 14,
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'inherit',
        textDecoration: 'underline',
      }}
    >
      Sign out
    </button>
  );
}