"use client";

import React, { useEffect, useState } from 'react';
import DashboardToggle from '../../components/DashboardToggle';
import { useRouter } from 'next/navigation';

export default function AdminRprPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<any | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const meRes = await fetch('/api/dashboard');
        if (!meRes.ok) {
          router.push('/');
          return;
        }
        const meJson = await meRes.json();
        if (!meJson.user || meJson.user.role !== 'attending') {
          router.push('/');
          return;
        }
        if (mounted) setCurrentUser(meJson.user || null);
      } catch (err) {
        if (mounted) router.push('/');
      }
    })();
    return () => { mounted = false; };
  }, [router]);

  return (
    <div style={{ minHeight: '100vh', width: '100vw', background: 'linear-gradient(135deg, #c8ceee 30%, #a7abde 100%)', fontFamily: 'Ubuntu, sans-serif', padding: 20, boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 'calc(100vw - 40px)', margin: '0 auto' }}>
        <div style={{ background: '#fff', borderRadius: 16, padding: 24, marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: 32, fontWeight: 700, color: '#000', margin: '0 0 8px 0' }}>RPR Attending Dashboard</h1>
            <div style={{ marginTop: 6 }}>
              {currentUser ? (
                <div style={{ color: '#666', fontSize: 16, fontWeight: 400 }}>{`Welcome to your RPR hub, Dr. ${((currentUser as any)?.preferred_name && String((currentUser as any).preferred_name).trim()) ? String((currentUser as any).preferred_name).trim() : (currentUser.first_name ?? '')} ${currentUser.last_name ?? ''}!`}</div>
              ) : (
                <div style={{ color: '#666', fontSize: 16 }}>RPR Attending Dashboard</div>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <DashboardToggle epaPath="/adminepa" rprPath="/adminrpr" />
            <button
              onClick={() => {
                // Profile action placeholder
              }}
              style={{
                background: '#fff',
                color: '#374151',
                border: '1px solid rgba(55,65,81,0.08)',
                borderRadius: 8,
                padding: '10px 18px',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.12s ease',
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
              title="Profile"
            >
              Profile
            </button>
            <button
              onClick={() => router.push('/')}
              style={{
                background: 'linear-gradient(135deg, #ff6b6b, #ee5a52)',
                color: '#fff',
                border: '1px solid rgba(55,65,81,0.08)',
                borderRadius: 8,
                padding: '10px 18px',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.12s ease',
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexShrink: 0,
              }}
              title="Sign out of your account"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Body removed — header only per request */}
        <div style={{ background: '#fff', borderRadius: 12, padding: 24, minHeight: 240, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          {/* Intentionally left blank — RPR admin UI will be built here. */}
        </div>
      </div>
    </div>
  );
}
