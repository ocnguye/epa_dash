"use client";

import React, { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import RprTable from '../../components/RprTable';
import RprRpr4Compare from '../../components/RprRpr4Compare';
import RprCohortChart from '../../components/RprCohortChart';
import RprBreakdown from '../../components/RprBreakdown';
import DashboardToggle from '../../components/DashboardToggle';

type Row = Record<string, any>;

export default function RprDashPage() {
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [user, setUser] = useState<any | null>(null);
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [profileForm, setProfileForm] = useState<any>({ username: '', preferred_name: '', first_name: '', last_name: '', password: '', confirm_password: '', pgy: '' });
    const [profileLoading, setProfileLoading] = useState(false);
    const [profileError, setProfileError] = useState('');
    const [profileSuccess, setProfileSuccess] = useState('');
    const router = useRouter();
    
    // Keep cohort-specific score separate so changing cohort filter does NOT
    // trigger page-wide refreshes. cohortScore applies only to the Cohort
    // chart and the Compare control; Breakdown and the Table remain
    // independently controlled.
    const [cohortScore, setCohortScore] = useState<number | null>(4);

    const filteredRows = useMemo(() => {
        // Timeline filter removed — return all rows for the RPR dashboard
        if (!rows || rows.length === 0) return [] as Row[];
        return rows;
    }, [rows]);

    useEffect(() => {
        let mounted = true;
    setLoading(true);
    // The table should show ALL reports for the logged-in user (no RPR score filter).
    // Only Cohort and Compare components receive the rprScore filter.
    const apiUrl = `/api/rpr`;
    console.debug('[RPR Dashboard] fetching table data (no score)', apiUrl);

    fetch(apiUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
            .then(res => res.json())
            .then((payload) => {
                if (!mounted) return;
                if (payload && payload.success) {
                    setRows(payload.data || []);
                } else if (payload && !payload.success) {
                    setError(payload.message || 'API returned an error');
                } else {
                    setError('Unexpected API response');
                }
            })
            .catch((e) => {
                if (!mounted) return;
                setError(String(e?.message || e));
            })
            .finally(() => {
                if (mounted) setLoading(false);
            });
        return () => { mounted = false; };
    }, []);

    useEffect(() => {
        // fetch basic user info for header display
        let mounted = true;
        fetch('/api/user')
            .then(r => r.json())
            .then(p => {
                if (!mounted) return;
                if (p && p.success && p.user) setUser(p.user);
            })
            .catch(() => {})
        return () => { mounted = false; };
    }, []);

    // Prefill profile form when modal opens
    useEffect(() => {
        if (showProfileModal && user) {
            setProfileForm({
                username: user.username || '',
                preferred_name: user.preferred_name || '',
                first_name: user.first_name || '',
                last_name: user.last_name || '',
                password: '',
                confirm_password: '',
                pgy: typeof user.pgy !== 'undefined' && user.pgy !== null ? String(user.pgy) : ''
            });
            setProfileError('');
            setProfileSuccess('');
        }
    }, [showProfileModal, user]);

    const submitProfileUpdate = async (e?: React.FormEvent) => {
        e?.preventDefault();
        setProfileError('');
        setProfileSuccess('');
        if (profileForm.password && profileForm.password.length > 0 && profileForm.password.length < 8) {
            setProfileError('Password must be at least 8 characters');
            return;
        }
        if (profileForm.password && profileForm.password !== profileForm.confirm_password) {
            setProfileError('New password and confirmation do not match');
            return;
        }

        setProfileLoading(true);
        try {
            const payload: any = {};
            if (profileForm.username) payload.username = profileForm.username;
            if (profileForm.password) payload.password = profileForm.password;
            if (typeof profileForm.preferred_name !== 'undefined') payload.preferred_name = profileForm.preferred_name;
            if (typeof profileForm.first_name !== 'undefined') payload.first_name = profileForm.first_name;
            if (typeof profileForm.last_name !== 'undefined') payload.last_name = profileForm.last_name;
            if (typeof profileForm.pgy !== 'undefined' && profileForm.pgy !== '') payload.pgy = Number(profileForm.pgy);

            const res = await fetch('/api/user', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) {
                setProfileError(data?.message || 'Failed to update profile');
            } else {
                setProfileSuccess(data?.message || 'Profile updated');
                // refresh header user info
                const ur = await fetch('/api/user');
                const up = await ur.json();
                if (up && up.success && up.user) setUser(up.user);
                setTimeout(() => setShowProfileModal(false), 800);
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
                width: '100vw',
                background: 'linear-gradient(135deg, #c8ceee 40%, #a7abde 100%)',
                fontFamily: 'Ubuntu, sans-serif',
                padding: 20,
                boxSizing: 'border-box',
            }}
        >
            <div style={{ maxWidth: 'calc(100vw - 40px)', margin: '0 auto' }}>
                <div style={{
                    background: '#fff',
                    borderRadius: 16,
                    padding: 24,
                    marginBottom: 20,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                }}>
                    <div>
                        <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 8px 0', color: '#111' }}>RPR Dashboard</h1>
                        <div style={{ color: '#444', fontSize: 16 }}>
                            {user ? (
                                <>
                                    <strong>Trainee:</strong>
                                    <span>{` ${((user as any)?.preferred_name && String((user as any).preferred_name).trim()) ? String((user as any).preferred_name).trim() : user.first_name} ${user.last_name}`}</span>
                                    <span>{' | '}</span>
                                    <strong>PGY:</strong>
                                    <span>{` ${(user as any)?.pgy != null ? (user as any).pgy : ''}`}</span>
                                    <span>{' | '}</span>
                                    <strong>Specialty:</strong>
                                    <span>{` ${user.specialty ?? 'Interventional Radiology'}`}</span>
                                </>
                            ) : (
                                'Loading user info...'
                            )}
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                            <DashboardToggle />
                        </div>

                        <button
                            onClick={() => setShowProfileModal(true)}
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
                            title="Edit your account"
                            onMouseEnter={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
                                (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 8px rgba(0,0,0,0.08)';
                            }}
                            onMouseLeave={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
                                (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)';
                            }}
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
                            title="Sign out of your account"
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

                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 20 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {loading ? (
                            <div style={{ padding: 20, background: '#fff', borderRadius: 8 }}>Loading…</div>
                        ) : error ? (
                            <div style={{ padding: 20, background: '#fff', borderRadius: 8, color: 'red' }}>{error}</div>
                        ) : (
                            <>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 12, alignItems: 'stretch', marginTop: 8 }}>
                                    <div style={{ minWidth: 0, minHeight: 520, height: '100%' }}>
                                        <RprCohortChart score={cohortScore} />
                                    </div>
                                    <div style={{ minHeight: 560, height: '100%' }}>
                                        <RprRpr4Compare score={cohortScore} setScore={setCohortScore} />
                                    </div>
                                </div>

                                <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '720px 1fr', gap: 12, alignItems: 'stretch' }}>
                                    <div style={{ minHeight: 560, height: '100%' }}>
                                        <RprBreakdown />
                                    </div>
                                    <div style={{ minHeight: 560, height: '100%' }}>
                                        <RprTable rows={filteredRows} />
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
                {showProfileModal && (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                        <form onSubmit={submitProfileUpdate} style={{ width: 640, maxWidth: '90%', background: '#fff', borderRadius: 12, padding: 20 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                <div style={{ fontSize: 18, fontWeight: 700 }}>Edit Profile</div>
                                <button type="button" onClick={() => setShowProfileModal(false)} style={{ background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer' }}>×</button>
                            </div>
                            {profileError && <div style={{ color: 'red', marginBottom: 8 }}>{profileError}</div>}
                            {profileSuccess && <div style={{ color: 'green', marginBottom: 8 }}>{profileSuccess}</div>}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                <div>
                                    <label style={{ fontSize: 13, color: '#333' }}>First name</label>
                                    <input value={profileForm.first_name} onChange={e => setProfileForm({...profileForm, first_name: e.target.value})} style={{ width: '100%', padding: 8, marginTop: 6 }} />
                                </div>
                                <div>
                                    <label style={{ fontSize: 13, color: '#333' }}>Last name</label>
                                    <input value={profileForm.last_name} onChange={e => setProfileForm({...profileForm, last_name: e.target.value})} style={{ width: '100%', padding: 8, marginTop: 6 }} />
                                </div>
                                <div>
                                    <label style={{ fontSize: 13, color: '#333' }}>Preferred name</label>
                                    <input value={profileForm.preferred_name} onChange={e => setProfileForm({...profileForm, preferred_name: e.target.value})} style={{ width: '100%', padding: 8, marginTop: 6 }} />
                                </div>
                                <div>
                                    <label style={{ fontSize: 13, color: '#333' }}>PGY</label>
                                    <input value={profileForm.pgy} onChange={e => setProfileForm({...profileForm, pgy: e.target.value})} style={{ width: '100%', padding: 8, marginTop: 6 }} />
                                </div>
                                <div>
                                    <label style={{ fontSize: 13, color: '#333' }}>New password</label>
                                    <input type="password" value={profileForm.password} onChange={e => setProfileForm({...profileForm, password: e.target.value})} style={{ width: '100%', padding: 8, marginTop: 6 }} />
                                </div>
                                <div>
                                    <label style={{ fontSize: 13, color: '#333' }}>Confirm password</label>
                                    <input type="password" value={profileForm.confirm_password} onChange={e => setProfileForm({...profileForm, confirm_password: e.target.value})} style={{ width: '100%', padding: 8, marginTop: 6 }} />
                                </div>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                                <button type="button" onClick={() => setShowProfileModal(false)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' }}>Cancel</button>
                                <button type="submit" disabled={profileLoading} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer' }}>{profileLoading ? 'Saving…' : 'Save'}</button>
                            </div>
                        </form>
                    </div>
                )}
            </div>
        </div>
    );
}
