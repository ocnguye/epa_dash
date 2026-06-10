"use client";

import React, { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';

// ─── Types ────────────────────────────────────────────────────────────────────

type AttendingSummary = {
    attending_user_id: number;
    name: string;
    reports_with_trainees: number;
    reports_with_epa: number;
    reports_missing_epa: number;
    provision_rate_pct: number | null;
    avg_epa_score: number | null;
    total_epa_scores_given: number;
};

type ReportDetail = {
    report_id: string;
    create_date: string | null;
    procedure_desc: string | null;
    complexity: number;
    trainee: {
        user_id: number;
        name: string;
        pgy: number | null;
        epa_score: number | null;
        epa_provided: boolean;
    };
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rateColor(rate: number | null): string {
    if (rate === null) return '#9ca3af';
    if (rate >= 80) return '#16a34a';
    if (rate >= 50) return '#d97706';
    return '#dc2626';
}

function rateBadgeStyle(rate: number | null): React.CSSProperties {
    if (rate === null) return { background: '#f3f4f6', color: '#6b7280' };
    if (rate >= 80) return { background: '#dcfce7', color: '#166534' };
    if (rate >= 50) return { background: '#fef9c3', color: '#854d0e' };
    return { background: '#fee2e2', color: '#991b1b' };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdminDash() {
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [currentUser, setCurrentUser] = useState<any | null>(null);

    const [summary, setSummary] = useState<AttendingSummary[]>([]);
    const [details, setDetails] = useState<Record<number, ReportDetail[]>>({});

    // drill-down state
    const [selectedAttending, setSelectedAttending] = useState<AttendingSummary | null>(null);
    const [detailTab, setDetailTab] = useState<'all' | 'missing' | 'provided'>('all');

    // filter + sort
    const [filterMode, setFilterMode] = useState<'all' | 'missing' | 'complete'>('all');
    const [sortMode, setSortMode] = useState<'rate_asc' | 'rate_desc' | 'name' | 'missing'>('rate_asc');

    // edit profile modal
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [profileForm, setProfileForm] = useState({ username: '', password: '', confirm_password: '', preferred_name: '', first_name: '', last_name: '' });
    const [profileLoading, setProfileLoading] = useState(false);
    const [profileError, setProfileError] = useState('');
    const [profileSuccess, setProfileSuccess] = useState('');

    // ── Auth + data load ───────────────────────────────────────────────────────

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch('/api/admin');
                if (res.status === 401 || res.status === 403) {
                    router.push('/');
                    return;
                }
                const data = await res.json();
                if (!data.success) {
                    setError(data.message || 'Failed to load EPA provision data');
                    setLoading(false);
                    return;
                }
                setSummary(data.summary || []);
                setDetails(data.details || []);
            } catch (err: any) {
                setError(err?.message || 'Server error');
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [router]);

    // ── Derived data ───────────────────────────────────────────────────────────

    const filtered = useMemo(() => {
        let list = summary.slice();
        if (filterMode === 'missing') list = list.filter(a => a.reports_missing_epa > 0);
        if (filterMode === 'complete') list = list.filter(a => a.reports_missing_epa === 0);
        list.sort((a, b) => {
            if (sortMode === 'rate_asc') return (a.provision_rate_pct ?? -1) - (b.provision_rate_pct ?? -1);
            if (sortMode === 'rate_desc') return (b.provision_rate_pct ?? -1) - (a.provision_rate_pct ?? -1);
            if (sortMode === 'name') return a.name.localeCompare(b.name);
            if (sortMode === 'missing') return b.reports_missing_epa - a.reports_missing_epa;
            return 0;
        });
        return list;
    }, [summary, filterMode, sortMode]);

    const metrics = useMemo(() => {
        const rates = summary.filter(a => a.provision_rate_pct !== null).map(a => a.provision_rate_pct as number);
        const avgRate = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null;
        const totalMissing = summary.reduce((s, a) => s + a.reports_missing_epa, 0);
        const scores = summary.filter(a => a.avg_epa_score !== null).map(a => a.avg_epa_score as number);
        const avgScore = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : null;
        return { total: summary.length, avgRate, totalMissing, avgScore };
    }, [summary]);

    const detailRows = useMemo(() => {
        if (!selectedAttending) return [];
        const rows = details[selectedAttending.attending_user_id] || [];
        if (detailTab === 'missing') return rows.filter(r => !r.trainee.epa_provided);
        if (detailTab === 'provided') return rows.filter(r => r.trainee.epa_provided);
        return rows;
    }, [selectedAttending, details, detailTab]);

    // ── Shared button styles ────────────────────────────────

    const headerBtnBase: React.CSSProperties = {
        background: '#fff',
        color: '#374151',
        border: '1px solid rgba(55,65,81,0.08)',
        borderRadius: 8,
        padding: '10px 18px',
        fontSize: 14,
        fontWeight: 600,
        cursor: 'pointer',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
    };

    // ── Render ─────────────────────────────────────────────────────────────────

    return (
        <div style={{ minHeight: '100vh', width: '100%', background: 'linear-gradient(135deg, #c8ceee 30%, #a7abde 100%)', fontFamily: 'Ubuntu, sans-serif', padding: 20, boxSizing: 'border-box' }}>
            <div style={{ maxWidth: 'calc(100vw - 40px)', margin: '0 auto' }}>

                {/* ── Header ── */}
                <div style={{ background: '#fff', borderRadius: 16, padding: 24, marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                        <h1 style={{ fontSize: 32, fontWeight: 700, color: '#000', margin: '0 0 8px 0' }}>Admin Dashboard</h1>
                        <div style={{ color: '#666', fontSize: 16, fontWeight: 400 }}>
                            {currentUser
                                ? `Welcome, ${currentUser.preferred_name?.trim() || currentUser.first_name} ${currentUser.last_name}. Here's your program-wide EPA overview.`
                                : 'Program-wide EPA provision overview.'}
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        {/* Navigate to attending / trainee pages */}
                        <button
                            onClick={() => router.push('/attendingepa')}
                            style={headerBtnBase}
                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 8px rgba(0,0,0,0.08)'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)'; }}
                        >
                            Attending view
                        </button>
                        <button
                            onClick={() => router.push('/epadash')}
                            style={headerBtnBase}
                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 8px rgba(0,0,0,0.08)'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)'; }}
                        >
                            Trainee view
                        </button>

                        {/* Edit profile */}
                        <button
                            onClick={() => {
                                setProfileError('');
                                setProfileSuccess('');
                                setProfileForm({
                                    username: currentUser?.username ?? '',
                                    password: '',
                                    confirm_password: '',
                                    preferred_name: currentUser?.preferred_name ?? '',
                                    first_name: currentUser?.first_name ?? '',
                                    last_name: currentUser?.last_name ?? '',
                                });
                                setShowProfileModal(true);
                            }}
                            style={headerBtnBase}
                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 8px rgba(0,0,0,0.08)'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)'; }}
                            title="Edit your account"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                            </svg>
                            Edit Profile
                        </button>

                        {/* Logout */}
                        <button
                            onClick={() => router.push('/')}
                            style={{ ...headerBtnBase, background: 'linear-gradient(135deg, #ff6b6b, #ee5a52)', color: '#fff', border: '1px solid rgba(55,65,81,0.08)' }}
                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 8px rgba(238,90,82,0.4)'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)'; }}
                            title="Sign out"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16,17 21,12 16,7" /><line x1="21" y1="12" x2="9" y2="12" />
                            </svg>
                            Logout
                        </button>
                    </div>
                </div>

                {/* ── Profile modal ── */}
                {showProfileModal && (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                        <div style={{ width: 520, background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 12px 40px rgba(0,0,0,0.3)', maxWidth: '95%' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#374151' }}>Edit Profile</h3>
                                <button onClick={() => setShowProfileModal(false)} style={{ background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888' }}>×</button>
                            </div>
                            <form onSubmit={async (e) => {
                                e.preventDefault();
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
                                    if (profileForm.username && profileForm.username !== currentUser?.username) payload.username = profileForm.username;
                                    if (profileForm.password) payload.password = profileForm.password;
                                    if (typeof profileForm.preferred_name !== 'undefined') payload.preferred_name = profileForm.preferred_name;
                                    if (profileForm.first_name !== currentUser?.first_name) payload.first_name = profileForm.first_name;
                                    if (profileForm.last_name !== currentUser?.last_name) payload.last_name = profileForm.last_name;

                                    const res = await fetch('/api/user', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                                    const data = await res.json();
                                    if (!res.ok) {
                                        setProfileError(data?.message || 'Failed to update profile');
                                    } else {
                                        setProfileSuccess(data?.message || 'Profile updated');
                                        const meRes = await fetch('/api/me');
                                        if (meRes.ok) { const me = await meRes.json(); setCurrentUser(me.user || null); }
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
                                            <input value={profileForm.first_name} onChange={e => setProfileForm(p => ({ ...p, first_name: e.target.value }))} style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #e6e6e6' }} placeholder="First name" />
                                        </label>
                                        <label style={{ fontSize: 13, color: '#333' }}>
                                            Last name
                                            <input value={profileForm.last_name} onChange={e => setProfileForm(p => ({ ...p, last_name: e.target.value }))} style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #e6e6e6' }} placeholder="Last name" />
                                        </label>
                                    </div>
                                    <label style={{ fontSize: 13, color: '#333' }}>
                                        Username
                                        <input value={profileForm.username} onChange={e => setProfileForm(p => ({ ...p, username: e.target.value }))} style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #e6e6e6' }} placeholder="username" />
                                    </label>
                                    <label style={{ fontSize: 13, color: '#333' }}>
                                        New password <span style={{ color: '#9ca3af', fontSize: 12, marginLeft: 6 }}>(leave blank to keep current)</span>
                                        <input type="password" value={profileForm.password} onChange={e => setProfileForm(p => ({ ...p, password: e.target.value }))} style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #e6e6e6' }} placeholder="new password" />
                                    </label>
                                    <label style={{ fontSize: 13, color: '#333' }}>
                                        Confirm new password
                                        <input type="password" value={profileForm.confirm_password} onChange={e => setProfileForm(p => ({ ...p, confirm_password: e.target.value }))} style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #e6e6e6' }} placeholder="confirm new password" />
                                    </label>
                                    <label style={{ fontSize: 13, color: '#333' }}>
                                        Preferred / display name
                                        <input value={profileForm.preferred_name} onChange={e => setProfileForm(p => ({ ...p, preferred_name: e.target.value }))} style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #e6e6e6' }} placeholder="Preferred name" />
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

                {/* ── Loading / error ── */}
                {loading ? (
                    <div style={{ background: '#fff', padding: 24, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>Loading...</div>
                ) : error ? (
                    <div style={{ background: '#fff', padding: 24, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', color: 'red' }}>{error}</div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                        {/* ── Metric cards ── */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                            {[
                                { label: 'Total attendings', value: metrics.total },
                                { label: 'Avg provision rate', value: metrics.avgRate !== null ? `${metrics.avgRate}%` : '—' },
                                { label: 'Reports missing EPA', value: metrics.totalMissing, danger: metrics.totalMissing > 0 },
                                { label: 'Avg EPA score', value: metrics.avgScore !== null ? `${metrics.avgScore} / 5` : '—' },
                            ].map(card => (
                                <div key={card.label} style={{ background: '#fff', borderRadius: 12, padding: '16px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                                    <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>{card.label}</div>
                                    <div style={{ fontSize: 28, fontWeight: 700, color: card.danger ? '#dc2626' : '#111827' }}>{card.value}</div>
                                </div>
                            ))}
                        </div>

                        {/* ── Filters ── */}
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                            <div style={{ background: '#fff', padding: 12, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
                                <label style={{ color: '#374151', fontWeight: 600, fontSize: 14 }}>Filter:</label>
                                <select value={filterMode} onChange={e => setFilterMode(e.target.value as any)} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e6e6e6', color: '#111827' }}>
                                    <option value="all">All attendings</option>
                                    <option value="missing">Missing EPAs only</option>
                                    <option value="complete">Fully compliant</option>
                                </select>
                            </div>
                            <div style={{ background: '#fff', padding: 12, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
                                <label style={{ color: '#374151', fontWeight: 600, fontSize: 14 }}>Sort by:</label>
                                <select value={sortMode} onChange={e => setSortMode(e.target.value as any)} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e6e6e6', color: '#111827' }}>
                                    <option value="rate_asc">Rate ↑ (worst first)</option>
                                    <option value="rate_desc">Rate ↓ (best first)</option>
                                    <option value="name">Name A–Z</option>
                                    <option value="missing">Missing count</option>
                                </select>
                            </div>
                        </div>

                        {/* ── Main content: table + detail panel ── */}
                        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>

                            {/* Attending table */}
                            <div style={{ background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 6px 24px rgba(15,23,42,0.06)', flex: selectedAttending ? '0 0 420px' : '1 1 0', minWidth: 0, transition: 'flex 0.2s' }}>
                                <div style={{ fontWeight: 700, color: '#374151', marginBottom: 12, fontSize: 15 }}>
                                    EPA provision by attending ({filtered.length})
                                </div>

                                {/* Table header */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 70px 70px 70px', gap: 8, padding: '6px 0', borderBottom: '2px solid #f3f4f6', fontSize: 12, color: '#6b7280', fontWeight: 600 }}>
                                    <span>Attending</span>
                                    <span>Rate</span>
                                    <span style={{ textAlign: 'right' }}>With EPA</span>
                                    <span style={{ textAlign: 'right' }}>Missing</span>
                                    <span style={{ textAlign: 'right' }}>Avg score</span>
                                </div>

                                {filtered.length === 0 ? (
                                    <div style={{ padding: '24px 0', textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>No attendings match this filter.</div>
                                ) : filtered.map(a => (
                                    <div
                                        key={a.attending_user_id}
                                        onClick={() => { setSelectedAttending(a); setDetailTab('all'); }}
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: '1fr 110px 70px 70px 70px',
                                            gap: 8,
                                            padding: '10px 8px',
                                            borderBottom: '1px solid #f3f4f6',
                                            cursor: 'pointer',
                                            borderRadius: 6,
                                            background: selectedAttending?.attending_user_id === a.attending_user_id ? '#f0f4ff' : 'transparent',
                                            alignItems: 'center',
                                        }}
                                        onMouseEnter={e => { if (selectedAttending?.attending_user_id !== a.attending_user_id) (e.currentTarget as HTMLDivElement).style.background = '#f9fafb'; }}
                                        onMouseLeave={e => { if (selectedAttending?.attending_user_id !== a.attending_user_id) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                                    >
                                        <span style={{ fontWeight: 600, color: '#111827', fontSize: 14 }}>{a.name}</span>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <span style={{ ...rateBadgeStyle(a.provision_rate_pct), fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 6 }}>
                                                {a.provision_rate_pct !== null ? `${a.provision_rate_pct}%` : 'N/A'}
                                            </span>
                                            <div style={{ flex: 1, height: 5, borderRadius: 3, background: '#f3f4f6', overflow: 'hidden', minWidth: 24 }}>
                                                <div style={{ height: '100%', borderRadius: 3, width: `${a.provision_rate_pct ?? 0}%`, background: rateColor(a.provision_rate_pct) }} />
                                            </div>
                                        </div>
                                        <span style={{ textAlign: 'right', color: '#6b7280', fontSize: 13 }}>{a.reports_with_epa}</span>
                                        <span style={{ textAlign: 'right', fontSize: 13, color: a.reports_missing_epa > 0 ? '#dc2626' : '#6b7280', fontWeight: a.reports_missing_epa > 0 ? 600 : 400 }}>{a.reports_missing_epa}</span>
                                        <span style={{ textAlign: 'right', color: '#6b7280', fontSize: 13 }}>{a.avg_epa_score !== null ? a.avg_epa_score.toFixed(1) : '—'}</span>
                                    </div>
                                ))}
                            </div>

                            {/* Detail panel */}
                            {selectedAttending && (
                                <div style={{ background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 6px 24px rgba(15,23,42,0.06)', flex: '1 1 0', minWidth: 0 }}>

                                    {/* Detail header */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                                        <div>
                                            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 2 }}>Report detail</div>
                                            <div style={{ fontSize: 17, fontWeight: 700, color: '#111827' }}>{selectedAttending.name}</div>
                                        </div>
                                        <button
                                            onClick={() => setSelectedAttending(null)}
                                            style={{ background: 'transparent', border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13, color: '#6b7280' }}
                                        >
                                            ← Back
                                        </button>
                                    </div>

                                    {/* Mini metrics */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
                                        {[
                                            { label: 'Reports w/ trainees', value: selectedAttending.reports_with_trainees, color: '#111827' },
                                            { label: 'EPA provided', value: selectedAttending.reports_with_epa, color: '#16a34a' },
                                            { label: 'Missing EPA', value: selectedAttending.reports_missing_epa, color: selectedAttending.reports_missing_epa > 0 ? '#dc2626' : '#16a34a' },
                                        ].map(m => (
                                            <div key={m.label} style={{ background: '#f9fafb', borderRadius: 8, padding: '10px 14px' }}>
                                                <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 2 }}>{m.label}</div>
                                                <div style={{ fontSize: 20, fontWeight: 700, color: m.color }}>{m.value}</div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Tabs */}
                                    <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                                        {(['all', 'missing', 'provided'] as const).map(t => (
                                            <button
                                                key={t}
                                                onClick={() => setDetailTab(t)}
                                                style={{
                                                    fontSize: 12,
                                                    padding: '5px 14px',
                                                    borderRadius: 6,
                                                    border: '1px solid #e5e7eb',
                                                    cursor: 'pointer',
                                                    background: detailTab === t ? '#3b82f6' : '#fff',
                                                    color: detailTab === t ? '#fff' : '#374151',
                                                    fontWeight: detailTab === t ? 600 : 400,
                                                }}
                                            >
                                                {t === 'all' ? 'All reports' : t === 'missing' ? 'Missing EPA' : 'EPA provided'}
                                            </button>
                                        ))}
                                    </div>

                                    {/* Report rows header */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 70px 80px', gap: 8, padding: '5px 0', borderBottom: '2px solid #f3f4f6', fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>
                                        <span>Procedure / date</span>
                                        <span>Trainee (PGY)</span>
                                        <span style={{ textAlign: 'right' }}>Complexity</span>
                                        <span style={{ textAlign: 'right' }}>EPA score</span>
                                    </div>

                                    {detailRows.length === 0 ? (
                                        <div style={{ padding: '24px 0', textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>No reports in this category.</div>
                                    ) : detailRows.map((r, i) => (
                                        <div key={`${r.report_id}-${r.trainee.user_id}-${i}`} style={{ display: 'grid', gridTemplateColumns: '1fr 160px 70px 80px', gap: 8, padding: '9px 0', borderBottom: '1px solid #f3f4f6', alignItems: 'center' }}>
                                            <div>
                                                <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{r.procedure_desc || 'Unknown procedure'}</div>
                                                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>{r.create_date || '—'} · #{r.report_id}</div>
                                            </div>
                                            <span style={{ fontSize: 13, color: '#6b7280' }}>
                                                {r.trainee.name}{r.trainee.pgy ? ` · PGY-${r.trainee.pgy}` : ''}
                                            </span>
                                            <span style={{ textAlign: 'right', fontSize: 13, color: '#6b7280' }}>{r.complexity ?? '—'}</span>
                                            <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5 }}>
                                                <span style={{ width: 7, height: 7, borderRadius: '50%', background: r.trainee.epa_provided ? '#16a34a' : '#dc2626', flexShrink: 0, display: 'inline-block' }} />
                                                <span style={{ fontSize: 13, color: r.trainee.epa_provided ? '#111827' : '#9ca3af' }}>
                                                    {r.trainee.epa_score !== null ? `${r.trainee.epa_score} / 5` : 'Missing'}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}