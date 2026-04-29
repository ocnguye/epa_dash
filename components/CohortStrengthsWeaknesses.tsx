"use client";

import React, { useEffect, useState, useMemo } from 'react';

type ProcedureStat = {
    desc: string;
    code: string;
    avg_epa: number;
    count: number;
};

type Props = {
    pgyFilter?: number | null;
};

export default function CohortStrengthsWeaknesses({ pgyFilter }: Props) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [procedures, setProcedures] = useState<ProcedureStat[]>([]);

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            setError(null);
            try {
                const url = pgyFilter != null
                    ? `/api/adminepa/cohortproc?pgy=${pgyFilter}`
                    : `/api/adminepa/cohortproc`;
                const res = await fetch(url);
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    setError(body?.message || 'Failed to load cohort procedures');
                    return;
                }
                const data = await res.json();
                setProcedures(data.procedures || []);
            } catch (err: any) {
                setError(err?.message || 'Server error');
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [pgyFilter]);

    const { strengths, weaknesses, hasData } = useMemo(() => {
        const qualified = procedures.filter(p => p.count >= 2);
        const sorted = qualified.slice().sort((a, b) => b.avg_epa - a.avg_epa);
        return {
            strengths: sorted.slice(0, 3),
            weaknesses: sorted.slice(-3).reverse(),
            hasData: qualified.length > 0,
        };
    }, [procedures]);

    const label = pgyFilter != null ? `PGY-${pgyFilter} Cohort` : 'Program-Wide';

    const renderRow = (p: ProcedureStat, idx: number) => (
        <div key={idx} style={{ padding: '10px 8px', borderBottom: '1px solid #f1f1f3', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: '#374151', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.desc}
                </div>
                <div style={{ color: '#6b7280', fontSize: 12, marginTop: 2 }}>
                    {p.count} report{p.count !== 1 ? 's' : ''}
                </div>
            </div>
            <div style={{
                flexShrink: 0,
                fontWeight: 700,
                fontSize: 15,
                color: p.avg_epa >= 4 ? '#166534' : p.avg_epa >= 3 ? '#92400e' : '#991b1b',
                background: p.avg_epa >= 4 ? '#dcfce7' : p.avg_epa >= 3 ? '#fef3c7' : '#fee2e2',
                borderRadius: 6,
                padding: '2px 10px',
                minWidth: 44,
                textAlign: 'center' as const,
            }}>
                {p.avg_epa.toFixed(2)}
            </div>
        </div>
    );

    return (
        <div style={{ background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4, color: '#374151' }}>
                Cohort Strengths &amp; Improvements
            </div>
            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 14 }}>
                {label} — by procedure average EPA
            </div>

            {loading ? (
                <div style={{ color: '#6b7280', padding: '24px 0', textAlign: 'center' }}>Loading...</div>
            ) : error ? (
                <div style={{ color: '#b91c1c', fontSize: 13 }}>{error}</div>
            ) : !hasData ? (
                <div style={{ color: '#6b7280', fontSize: 13, padding: '8px 0' }}>
                    No procedure data available{pgyFilter != null ? ` for PGY-${pgyFilter}` : ''}.
                </div>
            ) : (
                <>
                    <div style={{ marginBottom: 6, color: '#9CA3AF', fontSize: 13 }}><strong>Top Strengths</strong></div>
                    <div style={{ marginBottom: 16 }}>
                        {strengths.length
                            ? strengths.map(renderRow)
                            : <div style={{ color: '#6b7280', padding: '8px 6px', fontSize: 13 }}>No strengths identified</div>}
                    </div>
                    <div style={{ marginBottom: 6, color: '#9CA3AF', fontSize: 13 }}><strong>Areas to Improve</strong></div>
                    <div>
                        {weaknesses.length
                            ? weaknesses.map(renderRow)
                            : <div style={{ color: '#6b7280', padding: '8px 6px', fontSize: 13 }}>No areas identified</div>}
                    </div>
                </>
            )}
        </div>
    );
}