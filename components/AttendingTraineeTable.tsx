"use client";

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';

type Trainee = {
    user_id: number;
    preferred_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    role?: string | null;
    pgy?: number | null;
    specialty?: string | null;
    avg_epa?: number | null;
    report_count?: number;
};

type SortKey = 'name' | 'pgy' | 'avg_epa' | 'report_count';

export default function AttendingTraineeTable({
    trainees,
    maxHeight,
    pgyAvgMap = {},
}: {
    trainees: Trainee[];
    maxHeight?: number;
    pgyAvgMap?: Record<number, number>;
}) {
    const router = useRouter();
    const [sortKey, setSortKey] = useState<SortKey>('avg_epa');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

    const tableMaxHeight = maxHeight
        ? `${maxHeight - 48}px`
        : 'calc(100vh - 240px)';

    const handleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            // default direction per column
            setSortDir(key === 'name' ? 'asc' : 'desc');
        }
    };

    const sorted = useMemo(() => {
        return trainees.slice().sort((a, b) => {
            let cmp = 0;
            if (sortKey === 'name') {
                const nameA = ((a.preferred_name && String(a.preferred_name).trim())
                    ? `${String(a.preferred_name).trim()} ${a.last_name ?? ''}`
                    : `${a.first_name ?? ''} ${a.last_name ?? ''}`).trim().toLowerCase();
                const nameB = ((b.preferred_name && String(b.preferred_name).trim())
                    ? `${String(b.preferred_name).trim()} ${b.last_name ?? ''}`
                    : `${b.first_name ?? ''} ${b.last_name ?? ''}`).trim().toLowerCase();
                cmp = nameA.localeCompare(nameB);
            } else if (sortKey === 'pgy') {
                cmp = (a.pgy ?? 0) - (b.pgy ?? 0);
            } else if (sortKey === 'avg_epa') {
                cmp = (Number(a.avg_epa) || 0) - (Number(b.avg_epa) || 0);
            } else if (sortKey === 'report_count') {
                cmp = (a.report_count ?? 0) - (b.report_count ?? 0);
            }
            return sortDir === 'asc' ? cmp : -cmp;
        });
    }, [trainees, sortKey, sortDir]);

    const SortIcon = ({ col }: { col: SortKey }) => {
        if (sortKey !== col) return (
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

    const thStyle = (col: SortKey): React.CSSProperties => ({
        padding: '8px 12px',
        textAlign: 'left',
        color: sortKey === col ? '#374151' : '#495057',
        fontWeight: 600,
        borderBottom: '1px solid #dee2e6',
        cursor: 'pointer',
        userSelect: 'none',
        whiteSpace: 'nowrap',
    });

    return (
        <div style={{
            overflowX: 'auto',
            overflowY: 'auto',
            maxHeight: tableMaxHeight,
            border: '1px solid #e9ecef',
            borderRadius: 6,
            fontSize: 13,
        }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800, color: '#0f172a' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#f8f9fa', zIndex: 1, boxShadow: '0 2px 6px rgba(0,0,0,0.06)' }}>
                    <tr>
                        <th style={thStyle('name')} onClick={() => handleSort('name')}>
                            <span style={{ display: 'flex', alignItems: 'center' }}>Name <SortIcon col="name" /></span>
                        </th>
                        <th style={{ padding: '8px 12px', textAlign: 'left', color: '#495057', fontWeight: 600, borderBottom: '1px solid #dee2e6' }}>Role</th>
                        <th style={thStyle('pgy')} onClick={() => handleSort('pgy')}>
                            <span style={{ display: 'flex', alignItems: 'center' }}>PGY <SortIcon col="pgy" /></span>
                        </th>
                        <th style={{ padding: '8px 12px', textAlign: 'left', color: '#495057', fontWeight: 600, borderBottom: '1px solid #dee2e6' }}>Specialty</th>
                        <th style={thStyle('avg_epa')} onClick={() => handleSort('avg_epa')}>
                            <span style={{ display: 'flex', alignItems: 'center' }}>Avg EPA <SortIcon col="avg_epa" /></span>
                        </th>
                        <th style={thStyle('report_count')} onClick={() => handleSort('report_count')}>
                            <span style={{ display: 'flex', alignItems: 'center' }}>Reports <SortIcon col="report_count" /></span>
                        </th>
                        <th style={{ padding: '8px 12px', borderBottom: '1px solid #dee2e6' }}></th>
                    </tr>
                </thead>
                <tbody>
                    {sorted.map(t => {
                        const cohortAvg = t.pgy != null ? (pgyAvgMap[t.pgy] ?? 0) : 0;
                        return (
                            <tr key={t.user_id} style={{ borderBottom: '1px solid #f8f9fa' }}>
                                <td style={{ padding: '8px 12px', color: '#000' }}>
                                    <div style={{ fontWeight: 600 }}>
                                        {(t.preferred_name && String(t.preferred_name).trim())
                                            ? `${String(t.preferred_name).trim()} ${t.last_name ?? ''}`.trim()
                                            : `${t.first_name ?? ''} ${t.last_name ?? ''}`.trim()}
                                    </div>
                                </td>
                                <td style={{ padding: '8px 12px', color: '#000', textTransform: 'capitalize' }}>{t.role ?? ''}</td>
                                <td style={{ padding: '8px 12px', color: '#000' }}>{t.pgy ?? ''}</td>
                                <td style={{ padding: '8px 12px', color: '#000' }}>{t.specialty ?? 'Interventional Radiology'}</td>
                                <td style={{ padding: '8px 12px', color: '#000' }}>
                                    {typeof t.avg_epa === 'number'
                                        ? (t.avg_epa.toFixed ? t.avg_epa.toFixed(2) : t.avg_epa)
                                        : (t.avg_epa ?? 0)}
                                </td>
                                <td style={{ padding: '8px 12px', color: '#000' }}>{t.report_count ?? 0}</td>
                                <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                                    <button
                                        onClick={() => {
                                            const encoded = btoa(cohortAvg.toFixed(2));
                                            router.push(`/attendingepa/trainee/${t.user_id}?ca=${encoded}`);
                                        }}
                                        style={{ background: 'linear-gradient(135deg, #4a90e2, #2b7bd3)', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 12 }}
                                    >
                                        View
                                    </button>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}