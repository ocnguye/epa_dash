'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function AccountButton({ account }: { account: any }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function choose() {
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/auth/select-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: account.user_id }),
      });
      if (!res.ok) {
        console.error('select-account failed', res.status, await res.text());
        setErr(`Could not select this account (${res.status}).`);
        setBusy(false);
        return;
      }
      router.replace('/post-login');
    } catch {
      setErr('Network error. Please try again.');
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        onClick={choose}
        disabled={busy}
        className="w-full rounded-lg border p-4 text-left hover:bg-gray-50 disabled:opacity-60"
      >
        <div className="font-medium capitalize">{account.role} Dashboard</div>
        <div className="text-sm text-gray-500">
          {account.preferred_name || `${account.first_name} ${account.last_name}`}
        </div>
      </button>
      {err && <div className="text-sm text-red-700 mt-1">{err}</div>}
    </div>
  );
}