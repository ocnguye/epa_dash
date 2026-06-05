"use client";

import React, { useEffect, useState, useMemo } from 'react';

export type ProcedureStat = {
    desc: string;
    code: string;
    avg_epa: number;
    count: number;
};

type Props = {
    pgyFilter?: number | null;
    mode: 'strengths' | 'weaknesses';
    localProcedures?: ProcedureStat[]; // if provided, skip fetch and use this data
};

export default function CohortStrengthsWeaknesses({ pgyFilter, mode, localProcedures }: Props) {
    const [loading, setLoading] = useState(!localProcedures);
    const [error, setError] = useState<string | null>(null);
    const [procedures, setProcedures] = useState<ProcedureStat[]>(localProcedures ?? []);

    useEffect(() => {
        if (localProcedures) {
            setProcedures(localProcedures);
            setLoading(false);
            return;
        }
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
    }, [pgyFilter, localProcedures]);

    const items = useMemo(() => {
        const qualified = procedures.filter(p => p.count >= 2);
        const sorted = qualified.slice().sort((a, b) => b.avg_epa - a.avg_epa);
        if (mode === 'strengths') return sorted.slice(0, 10);
        return sorted.slice(-10).reverse();
    }, [procedures, mode]);

    const hasData = items.length > 0;
    const label = pgyFilter != null ? `PGY-${pgyFilter} Cohort` : 'Program-Wide';
    const title = mode === 'strengths' ? 'Top Strengths' : 'Areas to Improve';
    const emptyMsg = mode === 'strengths' ? 'No strengths identified' : 'No areas identified';

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
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: '#374151' }}>
                {title}
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
                <div style={{ overflowY: 'auto', flex: 1 }}>
                    {items.map(renderRow)}
                </div>
            )}
        </div>
    );
}