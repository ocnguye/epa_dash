'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

const ACCENTS = {
  blue:   { bg: 'rgba(175, 213, 240, 0.6)', border: '#afd5f0' },
  green:  { bg: 'rgba(178, 211, 194, 0.6)', border: '#b2d3c2' },
  purple: { bg: 'rgba(200, 206, 238, 0.6)', border: '#c8ceee' },
  yellow: { bg: 'rgba(255, 226, 108, 0.6)', border: '#ffe26c' },
} as const;

const ICONS: Record<string, React.ReactNode> = {
  trainee: (
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  attending: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  admin: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  tool: (
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>
  ),
};

type Props = {
  userId: number;
  title: string;
  subtitle?: string;
  destination?: string;
  accent?: keyof typeof ACCENTS;
  icon?: keyof typeof ICONS;
};

export default function AccountButton({
  userId,
  title,
  subtitle,
  destination = '/post-login',
  accent = 'blue',
  icon = 'trainee',
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [hover, setHover] = useState(false);
  const a = ACCENTS[accent];

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
        setErr(`Could not open this dashboard (error ${res.status}). Please try again.`);
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
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '14px 16px',
          minHeight: 64,
          boxSizing: 'border-box',
          textAlign: 'left',
          background: '#fff',
          border: `1px solid ${hover ? a.border : '#e5e7eb'}`,
          borderRadius: 12,
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.6 : 1,
          fontFamily: 'inherit',
          transform: hover && !busy ? 'translateY(-1px)' : 'none',
          boxShadow: hover && !busy ? '0 4px 12px rgba(0,0,0,0.10)' : '0 1px 2px rgba(0,0,0,0.04)',
          transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.15s',
        }}
      >
        <span
          style={{
            flexShrink: 0,
            width: 44,
            height: 44,
            borderRadius: 10,
            background: a.bg,
            border: `1px solid ${a.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#374151',
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {ICONS[icon]}
          </svg>
        </span>

        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 16, fontWeight: 700, color: '#111827' }}>
            {busy ? 'Opening…' : title}
          </span>
          {subtitle && (
            <span style={{ display: 'block', fontSize: 13, color: '#4b5563', marginTop: 2 }}>
              {subtitle}
            </span>
          )}
        </span>

        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9ca3af"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>

      {err && (
        <div role="alert" style={{ color: '#b91c1c', fontSize: 13, marginTop: 6 }}>{err}</div>
      )}
    </div>
  );
}