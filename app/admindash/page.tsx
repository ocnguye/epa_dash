"use client";

import React, { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import ProvisionGauge from '../../components/EPAProvisionGauge';

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

// ─── Color palette (matches epadash) ─────────────────────────────────────────

const COLORS = {
    blue:   'rgba(175, 213, 240, 0.6)',
    green:  'rgba(178, 211, 194, 0.6)',
    red:    'rgba(255, 126, 112, 0.6)',
    purple: 'rgba(200, 206, 238, 0.6)',
    yellow: 'rgba(255, 226, 108, 0.6)',
};
const BORDERS = {
    blue:   '#afd5f0',
    green:  '#b2d3c2',
    red:    '#ff7e70',
    purple: '#c8ceee',
    yellow: '#ffe26c',
};

// Rate color uses palette levels
function rateColor(rate: number | null): string {
    if (rate === null) return '#9ca3af';
    if (rate >= 80) return BORDERS.green;
    if (rate >= 50) return BORDERS.yellow;
    return BORDERS.red;
}

function rateBadgeBg(rate: number | null): string {
    if (rate === null) return '#f3f4f6';
    if (rate >= 80) return COLORS.green;
    if (rate >= 50) return COLORS.yellow;
    return COLORS.red;
}

function rateBadgeTextColor(rate: number | null): string {
    if (rate === null) return '#6b7280';
    if (rate >= 80) return '#1a5c30';
    if (rate >= 50) return '#7a5800';
    return '#a02010';
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdminDash() {
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [currentUser, setCurrentUser] = useState<any | null>(null);

    const [summary, setSummary] = useState<AttendingSummary[]>([]);
    const [details, setDetails] = useState<Record<number, ReportDetail[]>>({});
    const [totalMissingEpa, setTotalMissingEpa] = useState<number>(0);

    // drill-down state
    const [selectedAttending, setSelectedAttending] = useState<AttendingSummary | null>(null);
    const [detailTab, setDetailTab] = useState<'all' | 'missing' | 'provided'>('all');

    // filter + sort
    const [sortField, setSortField] = useState<'name' | 'rate' | 'with_epa' | 'missing' | 'avg_score'>('rate');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

    // profile modal
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
                if (res.status === 401 || res.status === 403) { router.push('/'); return; }
                const data = await res.json();
                if (!data.success) { setError(data.message || 'Failed to load EPA provision data'); setLoading(false); return; }
                setSummary(data.summary || []);
                setDetails(data.details || {});
                setTotalMissingEpa(data.total_missing_epa ?? 0);
            } catch (err: any) {
                setError(err?.message || 'Server error');
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [router]);

    // ── Derived data ───────────────────────────────────────────────────────────

    function handleSort(field: typeof sortField) {
        if (sortField === field) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDir('asc');
        }
    }

    const filtered = useMemo(() => {
        let list = summary.slice();
        list.sort((a, b) => {
            let diff = 0;
            if (sortField === 'name') diff = a.name.localeCompare(b.name);
            else if (sortField === 'rate') diff = (a.provision_rate_pct ?? -1) - (b.provision_rate_pct ?? -1);
            else if (sortField === 'with_epa') diff = a.reports_with_epa - b.reports_with_epa;
            else if (sortField === 'missing') diff = a.reports_missing_epa - b.reports_missing_epa;
            else if (sortField === 'avg_score') diff = (a.avg_epa_score ?? -1) - (b.avg_epa_score ?? -1);
            return sortDir === 'asc' ? diff : -diff;
        });
        return list;
    }, [summary, sortField, sortDir]);

    const metrics = useMemo(() => {
        const rates = summary.filter(a => a.provision_rate_pct !== null).map(a => a.provision_rate_pct as number);
        const avgRate = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null;
        const scores = summary.filter(a => a.avg_epa_score !== null).map(a => a.avg_epa_score as number);
        const avgScore = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : null;
        return { total: summary.length, avgRate, totalMissing: totalMissingEpa, avgScore };
    }, [summary, totalMissingEpa]);

    const detailRows = useMemo(() => {
        if (!selectedAttending) return [];
        const rows = details[selectedAttending.attending_user_id] || [];
        if (detailTab === 'missing') return rows.filter(r => !r.trainee.epa_provided);
        if (detailTab === 'provided') return rows.filter(r => r.trainee.epa_provided);
        return rows;
    }, [selectedAttending, details, detailTab]);

    // ── Shared button styles ───────────────────────────────────────────────────

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

    const thStyle = (field: typeof sortField): React.CSSProperties => ({
        padding: '8px 12px',
        textAlign: 'left',
        color: sortField === field ? '#374151' : '#495057',
        fontWeight: 600,          // always 600, no conditional
        borderBottom: '1px solid #dee2e6',
        cursor: 'pointer',
        userSelect: 'none',
        whiteSpace: 'nowrap',
    });

    const SortIcon = ({ col }: { col: typeof sortField }) => {
        if (sortField !== col) return (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.3, marginLeft: 4 }}>
                <path d="M12 5v14M5 12l7-7 7 7"/>
            </svg>
        );
        return sortDir === 'asc' ? (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: 4 }}>
                <path d="M12 5v14"/><path d="M5 12l7-7 7 7"/>
            </svg>
        ) : (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: 4 }}>
                <path d="M12 19V5"/><path d="M19 12l-7 7-7-7"/>
            </svg>
        );
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
                                : 'Welcome to the admin hub. Here is a program-wide EPA provision overview across all attendings.'}
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <button onClick={() => router.push('/adminepa')} style={headerBtnBase}
                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 8px rgba(0,0,0,0.08)'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)'; }}>
                            Attending view
                        </button>
                        <button onClick={() => router.push('/epadash')} style={headerBtnBase}
                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 8px rgba(0,0,0,0.08)'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)'; }}>
                            Trainee view
                        </button>
                        <button
                            onClick={() => { setProfileError(''); setProfileSuccess(''); setProfileForm({ username: currentUser?.username ?? '', password: '', confirm_password: '', preferred_name: currentUser?.preferred_name ?? '', first_name: currentUser?.first_name ?? '', last_name: currentUser?.last_name ?? '' }); setShowProfileModal(true); }}
                            style={headerBtnBase}
                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 8px rgba(0,0,0,0.08)'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)'; }}
                            title="Edit your account">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                            </svg>
                            Edit Profile
                        </button>
                        <button onClick={() => router.push('/')}
                            style={{ ...headerBtnBase, background: 'linear-gradient(135deg, #ff6b6b, #ee5a52)', color: '#fff', border: '1px solid rgba(55,65,81,0.08)' }}
                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 8px rgba(238,90,82,0.4)'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)'; }}
                            title="Sign out">
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
                                setProfileError(''); setProfileSuccess('');
                                if (profileForm.password && profileForm.password.length > 0 && profileForm.password.length < 8) { setProfileError('Password must be at least 8 characters'); return; }
                                if (profileForm.password && profileForm.password !== profileForm.confirm_password) { setProfileError('New password and confirmation do not match'); return; }
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
                                    if (!res.ok) { setProfileError(data?.message || 'Failed to update profile'); }
                                    else {
                                        setProfileSuccess(data?.message || 'Profile updated');
                                        const meRes = await fetch('/api/me');
                                        if (meRes.ok) { const me = await meRes.json(); setCurrentUser(me.user || null); }
                                        setTimeout(() => setShowProfileModal(false), 900);
                                    }
                                } catch (err: any) { setProfileError(err?.message || 'Server error'); }
                                finally { setProfileLoading(false); }
                            }}>
                                <div style={{ display: 'grid', gap: 12 }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                        <label style={{ fontSize: 13, color: '#333' }}>First name<input value={profileForm.first_name} onChange={e => setProfileForm(p => ({ ...p, first_name: e.target.value }))} style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #e6e6e6' }} placeholder="First name" /></label>
                                        <label style={{ fontSize: 13, color: '#333' }}>Last name<input value={profileForm.last_name} onChange={e => setProfileForm(p => ({ ...p, last_name: e.target.value }))} style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #e6e6e6' }} placeholder="Last name" /></label>
                                    </div>
                                    <label style={{ fontSize: 13, color: '#333' }}>Username<input value={profileForm.username} onChange={e => setProfileForm(p => ({ ...p, username: e.target.value }))} style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #e6e6e6' }} placeholder="username" /></label>
                                    <label style={{ fontSize: 13, color: '#333' }}>New password <span style={{ color: '#9ca3af', fontSize: 12, marginLeft: 6 }}>(leave blank to keep current)</span><input type="password" value={profileForm.password} onChange={e => setProfileForm(p => ({ ...p, password: e.target.value }))} style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #e6e6e6' }} placeholder="new password" /></label>
                                    <label style={{ fontSize: 13, color: '#333' }}>Confirm new password<input type="password" value={profileForm.confirm_password} onChange={e => setProfileForm(p => ({ ...p, confirm_password: e.target.value }))} style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #e6e6e6' }} placeholder="confirm new password" /></label>
                                    <label style={{ fontSize: 13, color: '#333' }}>Preferred / display name<input value={profileForm.preferred_name} onChange={e => setProfileForm(p => ({ ...p, preferred_name: e.target.value }))} style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #e6e6e6' }} placeholder="Preferred name" /></label>
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

                        {/* ── Metrics: 3 widgets left + gauge right ── */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 20, marginBottom: 4, alignItems: 'start' }}>

                            {/* Left column: 3 stacked widgets */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>

                                {/* Total attendings */}
                                <div style={{ background: '#fff', borderRadius: 12, padding: 24, textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                                    <div style={{ fontSize: 48, fontWeight: 700, color: BORDERS.blue, marginBottom: 8 }}>
                                        {metrics.total}
                                    </div>
                                    <div style={{ fontSize: 12, color: '#000', fontWeight: 600, textTransform: 'uppercase' }}>
                                        Total Attendings
                                    </div>
                                </div>

                                {/* Avg EPA score */}
                                <div style={{ background: '#fff', borderRadius: 12, padding: 24, textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                                    <div style={{ fontSize: 48, fontWeight: 700, color: BORDERS.green, marginBottom: 8 }}>
                                        {metrics.avgScore !== null ? metrics.avgScore : <span style={{ fontSize: 32, color: '#9ca3af' }}>N/A</span>}
                                    </div>
                                    <div style={{ fontSize: 12, color: '#000', fontWeight: 600, textTransform: 'uppercase' }}>
                                        Avg EPA Score
                                    </div>
                                </div>

                                {/* Reports missing EPA */}
                                <div style={{ background: '#fff', borderRadius: 12, padding: 24, textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                                    <div style={{ fontSize: 48, fontWeight: 700, color: metrics.totalMissing > 0 ? BORDERS.red : BORDERS.green, marginBottom: 8 }}>
                                        {metrics.totalMissing}
                                    </div>
                                    <div style={{ fontSize: 12, color: '#000', fontWeight: 600, textTransform: 'uppercase' }}>
                                        Reports Missing EPA
                                    </div>
                                </div>

                            </div>

                            {/* Right column: provision gauge */}
                            <div style={{ borderRadius: 12, padding: '24px 120px', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <ProvisionGauge rate={metrics.avgRate} size={250} stroke={16} />
                            </div>
                        </div>

                        {/* ── Main content: table + detail panel ── */}
                        <div style={{ display: 'flex', gap: 16, alignItems: 'stretch', maxHeight: 'calc(100vh - 200px)' }}>

                            {/* Attending table */}
                            <div style={{ background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 6px 24px rgba(15,23,42,0.06)', flex: selectedAttending ? '0 0 440px' : '1 1 0', minWidth: 0, transition: 'flex 0.2s', display: 'flex', flexDirection: 'column' }}>
                                <div style={{ fontWeight: 700, color: '#374151', marginBottom: 12, fontSize: 15, flexShrink: 0 }}>                                    
                                    EPA Provision by Attending ({filtered.length})
                                </div>

                                {/* Table header — clickable to sort */}
                                <div style={{ flex: 1, minHeight: 0, overflowX: 'auto', overflowY: 'auto', border: '1px solid #e9ecef', borderRadius: 6, fontSize: 13 }}>                                    
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                        <thead style={{ position: 'sticky', top: 0, background: '#f8f9fa', zIndex: 1, boxShadow: '0 2px 6px rgba(0,0,0,0.06)' }}>
                                            <tr>
                                                <th style={thStyle('name')} onClick={() => handleSort('name')}>
                                                    <span style={{ display: 'flex', alignItems: 'center' }}>Attending <SortIcon col="name" /></span>
                                                </th>
                                                <th style={thStyle('rate')} onClick={() => handleSort('rate')}>
                                                    <span style={{ display: 'flex', alignItems: 'center' }}>Provision Rate <SortIcon col="rate" /></span>
                                                </th>
                                                <th style={thStyle('with_epa')} onClick={() => handleSort('with_epa')}>
                                                    <span style={{ display: 'flex', alignItems: 'center' }}>With EPA <SortIcon col="with_epa" /></span>
                                                </th>
                                                <th style={thStyle('missing')} onClick={() => handleSort('missing')}>
                                                    <span style={{ display: 'flex', alignItems: 'center' }}>Missing EPA <SortIcon col="missing" /></span>
                                                </th>
                                                <th style={thStyle('avg_score')} onClick={() => handleSort('avg_score')}>
                                                    <span style={{ display: 'flex', alignItems: 'center' }}>Avg Evaluator EPA <SortIcon col="avg_score" /></span>
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filtered.length === 0 ? (
                                                <tr><td colSpan={5} style={{ padding: '24px 0', textAlign: 'center', color: '#9ca3af' }}>No attendings match this filter.</td></tr>
                                            ) : filtered.map(a => (
                                                <tr
                                                    key={a.attending_user_id}
                                                    onClick={() => { setSelectedAttending(a); setDetailTab('all'); }}
                                                    style={{
                                                        cursor: 'pointer',
                                                        background: selectedAttending?.attending_user_id === a.attending_user_id ? COLORS.blue : 'transparent',
                                                        borderBottom: '1px solid #f3f4f6',
                                                    }}
                                                    onMouseEnter={e => { if (selectedAttending?.attending_user_id !== a.attending_user_id) (e.currentTarget as HTMLTableRowElement).style.background = '#f9fafb'; }}
                                                    onMouseLeave={e => { if (selectedAttending?.attending_user_id !== a.attending_user_id) (e.currentTarget as HTMLTableRowElement).style.background = 'transparent'; }}
                                                >
                                                    <td style={{ padding: '10px 12px', fontWeight: 600, color: '#111827' }}>{a.name}</td>
                                                    <td style={{ padding: '10px 12px' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                            <span style={{ background: rateBadgeBg(a.provision_rate_pct), color: rateBadgeTextColor(a.provision_rate_pct), border: `1px solid ${rateColor(a.provision_rate_pct)}`, fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 6, whiteSpace: 'nowrap' }}>
                                                                {a.provision_rate_pct !== null ? `${a.provision_rate_pct}%` : 'N/A'}
                                                            </span>
                                                            <div style={{ flex: 1, height: 5, borderRadius: 3, background: '#f3f4f6', overflow: 'hidden', minWidth: 40 }}>
                                                                <div style={{ height: '100%', borderRadius: 3, width: `${a.provision_rate_pct ?? 0}%`, background: rateColor(a.provision_rate_pct), transition: 'width 0.3s' }} />
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '10px 12px', color: '#6b7280' }}>{a.reports_with_epa}</td>
                                                    <td style={{ padding: '10px 12px', color: a.reports_missing_epa > 0 ? BORDERS.red : '#6b7280', fontWeight: a.reports_missing_epa > 0 ? 700 : 400 }}>{a.reports_missing_epa}</td>
                                                    <td style={{ padding: '10px 12px', color: '#6b7280' }}>{a.avg_epa_score !== null ? a.avg_epa_score.toFixed(2) : '—'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Detail panel */}
                            {selectedAttending && (
                                <div style={{ background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 6px 24px rgba(15,23,42,0.06)', flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                                    {/* Detail header */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                                        <div>
                                            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 2 }}>Report Detail</div>
                                            <div style={{ fontSize: 17, fontWeight: 700, color: '#111827' }}>{selectedAttending.name}</div>
                                        </div>
                                        <button onClick={() => setSelectedAttending(null)} style={{ background: 'transparent', border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13, color: '#6b7280' }}>
                                            ← Back
                                        </button>
                                    </div>

                                    {/* Mini metrics */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
                                        {[
                                            { label: 'Reports With Trainees', value: selectedAttending.reports_with_trainees, color: BORDERS.blue },
                                            { label: 'EPA Provided', value: selectedAttending.reports_with_epa, color: BORDERS.green },
                                            { label: 'Missing EPA', value: selectedAttending.reports_missing_epa, color: selectedAttending.reports_missing_epa > 0 ? BORDERS.red : BORDERS.green },
                                        ].map(m => (
                                            <div key={m.label} style={{ background: '#fff', border: '1px solid #f3f4f6', borderRadius: 12, padding: '16px 14px', textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                                                <div style={{ fontSize: 32, fontWeight: 700, color: m.color, marginBottom: 6 }}>{m.value}</div>
                                                <div style={{ fontSize: 11, color: '#000', fontWeight: 600, textTransform: 'uppercase' }}>{m.label}</div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Tabs */}
                                    <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                                        {(['all', 'missing', 'provided'] as const).map(t => (
                                            <button key={t} onClick={() => setDetailTab(t)} style={{
                                                fontSize: 12, padding: '5px 14px', borderRadius: 6,
                                                border: `1px solid ${detailTab === t ? BORDERS.blue : '#e5e7eb'}`,
                                                cursor: 'pointer',
                                                background: detailTab === t ? COLORS.blue : '#fff',
                                                color: '#374151',
                                                fontWeight: detailTab === t ? 700 : 400,
                                            }}>
                                                {t === 'all' ? 'All reports' : t === 'missing' ? 'Missing EPA' : 'EPA provided'}
                                            </button>
                                        ))}
                                    </div>

                                    {/* Report rows header */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 80px', gap: 8, padding: '5px 0', borderBottom: `2px solid ${COLORS.purple}`, fontSize: 11, color: '#9ca3af', fontWeight: 600, flexShrink: 0 }}>
                                        <span>Procedure / Date / ReportID</span>
                                        <span>Trainee (PGY)</span>
                                        <span style={{ textAlign: 'right' }}>EPA Score</span>
                                    </div>

                                    {/* Scrollable report rows */}
                                    <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                                        {detailRows.length === 0 ? (
                                            <div style={{ padding: '24px 0', textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>No reports in this category.</div>
                                        ) : detailRows.map((r, i) => (
                                            <div key={`${r.report_id}-${r.trainee.user_id}-${i}`} style={{ display: 'grid', gridTemplateColumns: '1fr 160px 80px', gap: 8, padding: '9px 0', borderBottom: '1px solid #f3f4f6', alignItems: 'center' }}>
                                                <div>
                                                    <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{r.procedure_desc || 'Unknown procedure'}</div>
                                                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>
                                                        {r.create_date ? new Date(r.create_date.replace('Z', '')).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'} · #{r.report_id}
                                                    </div>                                                
                                                </div>
                                                <span style={{ fontSize: 13, color: '#6b7280' }}>
                                                    {r.trainee.name}{r.trainee.pgy ? ` · PGY-${r.trainee.pgy}` : ''}
                                                </span>
                                                <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5 }}>
                                                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: r.trainee.epa_provided ? BORDERS.green : BORDERS.red, flexShrink: 0, display: 'inline-block' }} />
                                                    <span style={{ fontSize: 13, color: r.trainee.epa_provided ? '#111827' : '#9ca3af' }}>
                                                        {r.trainee.epa_score !== null ? `${r.trainee.epa_score} / 5` : 'Missing'}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}