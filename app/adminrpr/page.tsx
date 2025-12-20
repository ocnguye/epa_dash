"use client";

import React, { useEffect, useRef, useState } from 'react';
import DashboardToggle from '../../components/DashboardToggle';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

const ResidencyAnalyticsWrapper = dynamic(() => import('../../components/ResidencyAnalytics'), { ssr: false });
const StudiesTimeSeriesWrapper = dynamic(() => import('../../components/StudiesTimeSeries'), { ssr: false });

type TabKey = 'Residency Analytics' | 'Studies Time Series';

const TAB_WIDTH = 240;
const TAB_HEIGHT = 44;
const TAB_OVERLAP = 10;

export default function AdminRprPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('Residency Analytics');

  const tabs: readonly TabKey[] = ['Residency Analytics', 'Studies Time Series'];

  // measure the rendered tab row height so we can position the content exactly
  const tabRowRef = useRef<HTMLDivElement | null>(null);
  const [measuredTabHeight, setMeasuredTabHeight] = useState<number>(TAB_HEIGHT);

  useEffect(() => {
    if (!tabRowRef.current) return;
    const el = tabRowRef.current;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = Math.round(entry.contentRect.height || TAB_HEIGHT);
        setMeasuredTabHeight(h);
      }
    });
    ro.observe(el);
    // set initial
    setMeasuredTabHeight(Math.round(el.getBoundingClientRect().height || TAB_HEIGHT));
    return () => ro.disconnect();
  }, [tabRowRef]);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/dashboard');
      if (!res.ok) return router.push('/');
      const data = await res.json();
      if (!data.user || data.user.role !== 'attending') {
        router.push('/');
      } else {
        setCurrentUser(data.user);
      }
    })();
  }, [router]);

  // Profile modal state (match other dashboards)
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileForm, setProfileForm] = useState({ username: '', password: '', confirm_password: '', preferred_name: '', first_name: '', last_name: '', role: '' });
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');

  const openProfileModal = () => {
    setProfileError('');
    setProfileSuccess('');
    setProfileForm({
      username: (currentUser as any)?.username ?? '',
      password: '',
      confirm_password: '',
      preferred_name: (currentUser as any)?.preferred_name ?? '',
      first_name: (currentUser as any)?.first_name ?? '',
      last_name: (currentUser as any)?.last_name ?? '',
      role: (currentUser as any)?.role ?? '',
    });
    setShowProfileModal(true);
  };

  const closeProfileModal = () => {
    setShowProfileModal(false);
    setProfileLoading(false);
    setProfileError('');
    setProfileSuccess('');
  };

  const submitProfileUpdate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setProfileError('');
    setProfileSuccess('');

    if (profileForm.password && profileForm.password.length > 0 && profileForm.password.length < 8) {
      setProfileError('Password must be at least 8 characters');
      return;
    }
    if (profileForm.password && profileForm.password.length > 0) {
      if ((profileForm.confirm_password ?? '') !== profileForm.password) {
        setProfileError('New password and confirmation do not match');
        return;
      }
    }

    setProfileLoading(true);
    try {
      const payload: any = {};
      if (profileForm.username && profileForm.username !== (currentUser as any)?.username) payload.username = profileForm.username;
      if (profileForm.password) payload.password = profileForm.password;
      if (typeof profileForm.preferred_name !== 'undefined') payload.preferred_name = profileForm.preferred_name;
      if (typeof profileForm.first_name !== 'undefined' && profileForm.first_name !== (currentUser as any)?.first_name) payload.first_name = profileForm.first_name;
      if (typeof profileForm.last_name !== 'undefined' && profileForm.last_name !== (currentUser as any)?.last_name) payload.last_name = profileForm.last_name;

      const res = await fetch('/api/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProfileError(data?.message || 'Failed to update profile');
      } else {
        setProfileSuccess(data?.message || 'Profile updated');
        // refresh current user info
        const meRes = await fetch('/api/dashboard');
        if (meRes.ok) {
          const me = await meRes.json();
          setCurrentUser(me.user || null);
        }
        setTimeout(() => closeProfileModal(), 900);
      }
    } catch (err: any) {
      setProfileError(err?.message || 'Server error');
    } finally {
      setProfileLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #c8ceee 30%, #a7abde 100%)',
        padding: 20,
        fontFamily: 'Ubuntu, sans-serif',
      }}
    >
      <div style={{ maxWidth: '100%', margin: '0 auto' }}>
        {/* HEADER */}
        <div
          style={{
            background: '#fff',
            borderRadius: 16,
            padding: 24,
            marginBottom: 20,
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <div>
            <h1 style={{ fontSize: 32, fontWeight: 700, color: '#111827' }}>RPR Attending Dashboard</h1>
            <div style={{ marginTop: 6, color: '#374151', fontSize: 16 }}>
              {currentUser && `Welcome to your hub for reviewing trainee RPR scores, Dr. ${currentUser.preferred_name?.trim() || currentUser.first_name} ${currentUser.last_name}`}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <DashboardToggle epaPath="/adminepa" rprPath="/adminrpr" />
            </div>
            <button
              onClick={() => {
                // prefill and open profile modal
                openProfileModal();
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
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
                (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 8px rgba(0,0,0,0.08)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
                (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)';
              }}
              title="Edit your account"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
              </svg>
              Edit Profile
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
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
                (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 8px rgba(238, 90, 82, 0.4)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
                (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)';
              }}
            >
              <svg 
                width="16" 
                height="16" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2" 
                strokeLinecap="round" 
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16,17 21,12 16,7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Logout
            </button>
          </div>
        </div>

        {/* Profile Edit Modal */}
        {showProfileModal && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div style={{ width: 520, background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 12px 40px rgba(0,0,0,0.3)', maxWidth: '95%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#374151' }}>Edit Profile</h3>
                <button onClick={() => setShowProfileModal(false)} style={{ background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888' }} title="Close">×</button>
              </div>

              <form onSubmit={submitProfileUpdate}>
                <div style={{ display: 'grid', gap: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <label style={{ fontSize: 13, color: '#333' }}>
                      First name
                      <input
                        value={profileForm.first_name}
                        onChange={(e) => setProfileForm(prev => ({ ...prev, first_name: e.target.value }))}
                        style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #e6e6e6' }}
                        placeholder="First name"
                      />
                    </label>

                    <label style={{ fontSize: 13, color: '#333' }}>
                      Last name
                      <input
                        value={profileForm.last_name}
                        onChange={(e) => setProfileForm(prev => ({ ...prev, last_name: e.target.value }))}
                        style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #e6e6e6' }}
                        placeholder="Last name"
                      />
                    </label>
                  </div>

                  <label style={{ fontSize: 13, color: '#333' }}>
                    Username
                    <input
                      value={profileForm.username}
                      onChange={(e) => setProfileForm(prev => ({ ...prev, username: e.target.value }))}
                      style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #e6e6e6' }}
                      placeholder="username"
                    />
                  </label>

                  <label style={{ fontSize: 13, color: '#333' }}>
                    New password
                    <span style={{ color: '#9ca3af', fontSize: 12, marginLeft: 6 }}>(leave blank to keep current)</span>
                    <input
                      type="password"
                      value={profileForm.password}
                      onChange={(e) => setProfileForm(prev => ({ ...prev, password: e.target.value }))}
                      style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #e6e6e6' }}
                      placeholder="new password"
                    />
                  </label>

                  <label style={{ fontSize: 13, color: '#333' }}>
                    Confirm new password
                    <input
                      type="password"
                      value={profileForm.confirm_password}
                      onChange={(e) => setProfileForm(prev => ({ ...prev, confirm_password: e.target.value }))}
                      style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #e6e6e6' }}
                      placeholder="confirm new password"
                    />
                  </label>

                  <label style={{ fontSize: 13, color: '#333' }}>
                    Preferred / display name
                    <input
                      value={profileForm.preferred_name}
                      onChange={(e) => setProfileForm(prev => ({ ...prev, preferred_name: e.target.value }))}
                      style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #e6e6e6' }}
                      placeholder="Preferred name"
                    />
                  </label>

                  {profileError && <div style={{ color: '#b91c1c', fontSize: 13 }}>{profileError}</div>}
                  {profileSuccess && <div style={{ color: '#166534', fontSize: 13 }}>{profileSuccess}</div>}

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
                    <button type="button" onClick={() => setShowProfileModal(false)} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #e6e6e6', background: '#fff', cursor: 'pointer' }}>Cancel</button>
                    <button type="submit" disabled={profileLoading} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #3b82f6, #2563eb)', color: '#fff', cursor: 'pointer' }}>{profileLoading ? 'Saving...' : 'Save'}</button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* TABBED SECTION */}
        <div style={{ position: 'relative' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              // keep tab row in normal flow; we'll lift the chart card itself so
              // it tucks under the tabs (more robust when chart components have
              // internal stacking contexts)
              marginBottom: 0,
              // render tabs in normal flow; we'll place them behind the chart by
              // lowering their stacking context so the card and decorative cover sit above
              zIndex: 1,
              position: 'relative',
              pointerEvents: 'auto',
            }}
            ref={tabRowRef}
          >
            {tabs.map((tab, i) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  width: TAB_WIDTH,
                  height: TAB_HEIGHT,
                  background: activeTab === tab ? '#6b7280' : '#e5e7fa',
                  color: activeTab === tab ? '#fff' : '#111827',
                  border: '1px solid rgba(107,114,128,0.4)',
                  borderBottom: activeTab === tab ? '1px solid #fff' : undefined,
                  borderRadius: '8px 8px 0 0',
                  marginLeft: i ? `-${TAB_OVERLAP}px` : 0,
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: 'pointer',
                  boxShadow: activeTab === tab ? '0 -2px 6px rgba(0,0,0,0.18)' : '0 -1px 4px rgba(0,0,0,0.08)',
          // keep buttons in the low stacking context so the chart card can sit above
            position: 'relative',
            // ensure left tabs layer above right tabs by assigning higher z-index
            // to tabs with lower index (i=0 on left). Keep values < chart zIndex (15).
            zIndex: 5 + (tabs.length - i),
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* area (outer wrapper removed) */}
          <div
            style={{
              background: 'transparent',
              borderRadius: 0,
              padding: 24,
              // small top margin to avoid clipping on very small measured heights
              // set to 0 to remove accidental gap between tabs and card
              marginTop: 4,
              minHeight: '78vh',
              boxShadow: 'none',
              position: 'relative',
              // keep content below the tabs
              zIndex: 10,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ flex: 1, minHeight: 0 }}>
              <div
                style={{
                  // keep wrapper the same width as the header container
                  position: 'relative',
                  zIndex: 15,
                  marginTop: -(Math.round(measuredTabHeight - 8)),
                  pointerEvents: 'auto',
                  // expand this inner wrapper out by the same horizontal padding
                  // used on the outer area (24px each side) so the chart card
                  // lines up with the header. We offset back with a negative
                  // left margin so the visual width matches the sibling header.
                  width: 'calc(100% + 48px)',
                  marginLeft: -24,
                  boxSizing: 'border-box',
                }}
              >
                {activeTab === 'Residency Analytics' && <ResidencyAnalyticsWrapper />}
                {activeTab === 'Studies Time Series' && <StudiesTimeSeriesWrapper />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}