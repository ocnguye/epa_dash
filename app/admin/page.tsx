"use client";

import React, { useEffect, useState, useMemo } from 'react';
import AdminCohortChart from '../../components/AdminCohortChart';
import AdminTraineeTable from '../../components/AdminTraineeTable';
import { useRouter } from 'next/navigation';

type Trainee = {
    user_id: number;
    username: string;
    first_name: string;
    last_name: string;
    preferred_name?: string | null;
    pgy?: number | null;
    specialty?: string | null;
    role?: string | null;
    avg_epa?: number;
    report_count?: number;
};

export default function AdminPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [trainees, setTrainees] = useState<Trainee[]>([]);
    const [currentUser, setCurrentUser] = useState<any | null>(null);
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [profileForm, setProfileForm] = useState({ username: '', password: '', confirm_password: '', preferred_name: '', first_name: '', last_name: '', role: '' });
    const [profileLoading, setProfileLoading] = useState(false);
    const [profileError, setProfileError] = useState('');
    const [profileSuccess, setProfileSuccess] = useState('');
    const [filterPgy, setFilterPgy] = useState<string>('all');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
    const [sortBy, setSortBy] = useState<'avg_epa' | 'pgy' | 'reports'>('avg_epa');

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            setError(null);
            try {
                // check current user role via dashboard
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
                // store current user for personalized header and profile edits
                setCurrentUser(meJson.user || null);

                const res = await fetch('/api/admin/trainees');
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    setError(err?.message || 'Failed to load trainees');
                    setLoading(false);
                    return;
                }
                const data = await res.json();
                // Normalize trainee fields to avoid mixed types from the API
                const normalized = (data.trainees || []).map((t: any) => {
                    // normalize pgy: null/undefined/empty -> null, numbers and numeric strings -> Number
                    let pgyVal: number | null = null;
                    if (t.pgy !== null && t.pgy !== undefined && String(t.pgy).trim() !== '') {
                        const n = Number(t.pgy);
                        pgyVal = Number.isFinite(n) ? n : null;
                    }

                    // normalize avg_epa: attempt Number coercion, keep null if missing
                    let avg: number | null = null;
                    if (t.avg_epa !== null && t.avg_epa !== undefined && String(t.avg_epa).trim() !== '') {
                        const n = Number(t.avg_epa);
                        avg = Number.isFinite(n) ? n : null;
                    }

                    // normalize report_count: default to 0 when missing
                    let reports = 0;
                    if (t.report_count !== null && t.report_count !== undefined && String(t.report_count).trim() !== '') {
                        const n = Number(t.report_count);
                        reports = Number.isFinite(n) ? n : 0;
                    }

                    return {
                        ...t,
                        pgy: pgyVal,
                        avg_epa: avg,
                        report_count: reports,
                    } as Trainee;
                });
                setTrainees(normalized || []);
            } catch (err: any) {
                setError(err?.message || 'Server error');
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [router]);

    const filtered = useMemo(() => {
        let list = trainees.slice();
        if (filterPgy !== 'all') {
            const pgyNum = Number(filterPgy);
            // compare against normalized numeric pgy (or null)
            list = list.filter(t => t.pgy === pgyNum);
        }
        if (sortBy === 'avg_epa') {
            list.sort((a,b) => sortOrder === 'asc' ? ((a.avg_epa || 0) - (b.avg_epa || 0)) : ((b.avg_epa || 0) - (a.avg_epa || 0)));
        }
        if (sortBy === 'pgy') {
            // respect sortOrder toggle: asc => 1..7, desc => 7..1
            list.sort((a,b) => sortOrder === 'asc' ? ((a.pgy || 0) - (b.pgy || 0)) : ((b.pgy || 0) - (a.pgy || 0)));
        }
        if (sortBy === 'reports') {
            list.sort((a,b) => sortOrder === 'asc' ? ((a.report_count || 0) - (b.report_count || 0)) : ((b.report_count || 0) - (a.report_count || 0)));
        }
        return list;
    }, [trainees, filterPgy, sortBy, sortOrder]);

    // Chart and table are rendered via encapsulated components below

    return (
        <div style={{ minHeight: '100vh', width: '100vw', background: 'linear-gradient(135deg, #c8ceee 30%, #a7abde 100%)', fontFamily: 'Ubuntu, sans-serif', padding: 20, boxSizing: 'border-box' }}>
        <div style={{ maxWidth: 'calc(100vw - 40px)', margin: '0 auto' }}>
            <div style={{ background: '#fff', borderRadius: 16, padding: 24, marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                        <h1 style={{ fontSize: 32, fontWeight: 700, color: '#000', margin: '0 0 8px 0' }}>EPA Attending Dashboard</h1>
                        <div style={{ marginTop: 6 }}>
                            {currentUser ? (
                                <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                                    <div style={{ color: '#666', fontSize: 16, fontWeight: 400 }}>{`Welcome to your hub for reviewing trainee progress, Dr. ${((currentUser as any)?.preferred_name && String((currentUser as any).preferred_name).trim()) ? String((currentUser as any).preferred_name).trim() : (currentUser.first_name ?? '')} ${currentUser.last_name ?? ''}!`}</div>
                                </div>
                            ) : (
                                <div style={{ color: '#666', fontSize: 16 }}>EPA Attending Dashboard — your hub for reviewing trainee progress and supporting development.</div>
                            )}
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <button
                            onClick={() => {
                                // Prefill form with current user values like trainee dashboard
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

                <div style={{ display: 'flex', gap: 16, marginBottom: 18, alignItems: 'center' }}>
                    <div style={{ background: '#fff', padding: 12, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 12 }}>
                            <label style={{ marginRight: 6, color: '#374151', fontWeight: 600 }}>Filter PGY:</label>
                            {/* Build PGY options in either ascending or descending order */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <select value={filterPgy} onChange={e => setFilterPgy(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e6e6e6', color: '#111827' }}>
                                    <option value="all">All</option>
                                    {([1,2,3,4,5,6,7] as number[])
                                        .slice()
                                                .sort((a,b) => a - b)
                                                .map(n => <option key={n} value={String(n)}>PGY {n}</option>)}
                                </select>
                                        <button
                                            onClick={() => {
                                                setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
                                            }}
                                            title={sortOrder === 'asc' ? 'Sort ascending' : 'Sort descending'}
                                    style={{
                                        background: '#fff',
                                        color: '#374151',
                                        border: '1px solid rgba(55,65,81,0.08)',
                                        padding: '8px',
                                        borderRadius: 8,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}
                                >
                                            {sortOrder === 'asc' ? (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M12 5v14" />
                                            <path d="M5 12l7-7 7 7" />
                                        </svg>
                                    ) : (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M12 19V5" />
                                            <path d="M19 12l-7 7-7-7" />
                                        </svg>
                                    )}
                                </button>
                            </div>
                        </div>

                    <div style={{ background: '#fff', padding: 12, borderRadius: 12, boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)', display: 'flex', alignItems: 'center', gap: 12 }}>
                        <label style={{ marginRight: 6, color: '#374151', fontWeight: 600 }}>Sort by:</label>
                        <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e6e6e6', color: '#111827' }}>
                            <option value="avg_epa">Average EPA</option>
                            <option value="pgy">PGY</option>
                            <option value="reports">Report Count</option>
                        </select>
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

                            <form onSubmit={async (e) => {
                                e.preventDefault();
                                setProfileError('');
                                setProfileSuccess('');
                                if (profileForm.password && profileForm.password.length > 0 && profileForm.password.length < 8) {
                                    setProfileError('Password must be at least 8 characters');
                                    return;
                                }
                                // If changing password, ensure confirmation matches
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
                                    // PGY changes are not allowed from the attending/admin profile UI

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
                                        // refresh current user info
                                        const meRes = await fetch('/api/dashboard');
                                        if (meRes.ok) {
                                            const me = await meRes.json();
                                            setCurrentUser(me.user || null);
                                        }
                                        setTimeout(() => setShowProfileModal(false), 900);
                                    }
                                } catch (err: any) {
                                    setProfileError(err?.message || 'Server error');
                                } finally {
                                    setProfileLoading(false);
                                }
                            }}>
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

                                    {/* PGY is not editable from the attending/admin profile */}

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

                {loading ? (
                    <div style={{ background: '#fff', padding: 24, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>Loading...</div>
                ) : error ? (
                    <div style={{ background: '#fff', padding: 24, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', color: 'red' }}>{error}</div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {/* Chart widget (stacked) */}
                        <div style={{ background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 6px 24px rgba(15,23,42,0.06)', width: '100%' }}>
                            <div style={{ fontWeight: 700, color: '#374151', marginBottom: 12 }}>Cohort EPA Comparison</div>
                            <div style={{ width: '100%' }}>
                                <AdminCohortChart trainees={filtered} />
                            </div>
                        </div>

                        {/* Table widget (stacked below) */}
                        <div style={{ background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 6px 24px rgba(15,23,42,0.06)', width: '100%' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                <div style={{ fontWeight: 700, color: '#374151' }}>Trainees ({filtered.length})</div>
                            </div>
                            <AdminTraineeTable trainees={filtered} />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
