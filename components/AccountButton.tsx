'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Props = {
  userId: number;
  title: string;
  subtitle?: string;
  destination?: string; // where to go after the profile is selected
};

export default function AccountButton({ userId, title, subtitle, destination = '/post-login' }: Props) {
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
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        console.error('select-account failed', res.status, await res.text());
        setErr(`Could not select this account (${res.status}).`);
        setBusy(false);
        return;
      }
      router.replace(destination);
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
        <div className="font-medium">{title}</div>
        {subtitle && <div className="text-sm text-gray-500">{subtitle}</div>}
      </button>
      {err && <div className="text-sm text-red-700 mt-1">{err}</div>}
    </div>
  );
}