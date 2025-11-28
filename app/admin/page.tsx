"use client";

import React, { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';

type Trainee = {
    user_id: number;
    username: string;
    first_name: string;
    last_name: string;
    preferred_name?: string | null;
    pgy?: number | null;
    role?: string | null;
    avg_epa?: number;
    report_count?: number;
};

export default function AdminPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [trainees, setTrainees] = useState<Trainee[]>([]);
    const [filterPgy, setFilterPgy] = useState<string>('all');
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

                const res = await fetch('/api/admin/trainees');
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    setError(err?.message || 'Failed to load trainees');
                    setLoading(false);
                    return;
                }
                const data = await res.json();
                setTrainees(data.trainees || []);
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
            list = list.filter(t => Number(t.pgy) === pgyNum);
        }
        if (sortBy === 'avg_epa') list.sort((a,b) => (b.avg_epa || 0) - (a.avg_epa || 0));
        if (sortBy === 'pgy') list.sort((a,b) => (b.pgy || 0) - (a.pgy || 0));
        if (sortBy === 'reports') list.sort((a,b) => (b.report_count || 0) - (a.report_count || 0));
        return list;
    }, [trainees, filterPgy, sortBy]);

    return (
        <div style={{ padding: 20, fontFamily: 'Ubuntu, sans-serif' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <h1 style={{ margin: 0 }}>EPA Administrator — Trainee Overview</h1>
                <div>
                    <button onClick={() => router.push('/')} style={{ marginRight: 8 }}>Back</button>
                </div>
            </div>

            <div style={{ marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
                <label>Filter PGY:</label>
                <select value={filterPgy} onChange={e => setFilterPgy(e.target.value)}>
                    <option value="all">All</option>
                    {[1,2,3,4,5,6,7,8].map(n => <option key={n} value={String(n)}>PGY {n}</option>)}
                </select>

                <label>Sort by:</label>
                <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}>
                    <option value="avg_epa">Average EPA</option>
                    <option value="pgy">PGY</option>
                    <option value="reports">Report Count</option>
                </select>
            </div>

            {loading ? (
                <div>Loading...</div>
            ) : error ? (
                <div style={{ color: 'red' }}>{error}</div>
            ) : (
                <div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                                <th style={{ padding: '8px' }}>Name</th>
                                <th>PGY</th>
                                <th>Avg EPA</th>
                                <th>Reports</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(t => (
                                <tr key={t.user_id} style={{ borderBottom: '1px solid #f1f1f1' }}>
                                    <td style={{ padding: '8px' }}>{t.preferred_name ? `${t.preferred_name}` : `${t.first_name} ${t.last_name}`}</td>
                                    <td>{t.pgy ?? ''}</td>
                                    <td>{t.avg_epa ?? 0}</td>
                                    <td>{t.report_count ?? 0}</td>
                                    <td><button onClick={() => router.push(`/admin/trainee/${t.user_id}`)}>View</button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
