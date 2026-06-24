'use client';

import React, { useMemo, useState, useRef, useEffect } from 'react';

type Procedure = {
    report_id: number;
    create_date: string;
    proc_desc?: string | null;
    proc_code?: string | null;
    fluoroscopy_time_minutes?: number | string | null;
    fluoroscopy_dose_value?: number | string | null;
    fluoroscopy_time_raw?: string | null;
    fluoroscopy_dose_unit?: string | null;
    fluoroscopy_time?: number | string | null;
    fluoro_time?: number | string | null;
    fluoroscopy_minutes?: number | string | null;
    fluoroscopy_seconds?: number | string | null;
    radiation_dose?: number | string | null;
    dose?: number | string | null;
    dlp?: number | string | null;
};

function extractNumber(proc: any, keys: string[]) {
    for (const k of keys) {
        if (proc && typeof proc[k] !== 'undefined' && proc[k] !== null && proc[k] !== '') {
            const v = Number(proc[k]);
            if (Number.isFinite(v)) return v;
        }
    }
    return undefined;
}

export default function KeyPerformanceMetrics({
    procedures,
    loading,
}: {
    procedures: Procedure[];
    loading: boolean;
}) {
    const toDate = (d?: string) => {
        if (!d) return undefined;
        const dt = new Date(d);
        if (!isNaN(dt.getTime())) return dt;
        const parts = d.split('-');
        if (parts.length >= 3) {
            const dd = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
            if (!isNaN(dd.getTime())) return dd;
        }
        return undefined;
    };

    const [recentFilter, setRecentFilter] = useState<string>('all');
    const [viewMode, setViewMode] = useState<'name' | 'code'>('name');
    const [toggleFocusWithin, setToggleFocusWithin] = useState(false);

    const recentCases = useMemo(() => {
        if (!procedures || procedures.length === 0) return [] as Procedure[];
        const list = [...procedures].sort(
            (a, b) => (toDate(b.create_date)?.getTime() || 0) - (toDate(a.create_date)?.getTime() || 0)
        );
        return recentFilter && recentFilter !== 'all'
            ? list.filter(p => {
                  const key =
                      (p.proc_desc && String(p.proc_desc).trim()) ||
                      (p.proc_code && String(p.proc_code).trim()) ||
                      'Unknown';
                  return key === recentFilter;
              })
            : list;
    }, [procedures, recentFilter]);

    const recentProcedureOptions = useMemo(() => {
        const map = new Map<string, string>();
        (procedures || []).forEach(p => {
            const key =
                (p.proc_desc && String(p.proc_desc).trim()) ||
                (p.proc_code && String(p.proc_code).trim()) ||
                'Unknown';
            if (!map.has(key)) map.set(key, key);
        });
        return [
            { key: 'all', label: 'All procedures' },
            ...Array.from(map.keys()).map(k => ({ key: k, label: k })),
        ];
    }, [procedures]);

    const groupedByName = useMemo(() => {
        const map: Record<string, Procedure[]> = {};
        (procedures || []).forEach(p => {
            const key = (p.proc_desc && String(p.proc_desc).trim()) || 'Unknown';
            (map[key] = map[key] || []).push(p);
        });
        return map;
    }, [procedures]);

    const groupedByCode = useMemo(() => {
        const map: Record<string, Procedure[]> = {};
        (procedures || []).forEach(p => {
            const key = (p.proc_code && String(p.proc_code).trim()) || 'Unknown';
            (map[key] = map[key] || []).push(p);
        });
        return map;
    }, [procedures]);

    const avgIntervalForGroup = (items: Procedure[]) => {
        const dates = items.map(i => toDate(i.create_date)).filter(Boolean) as Date[];
        if (dates.length < 2) return undefined;
        dates.sort((a, b) => a.getTime() - b.getTime());
        const diffs = dates.slice(1).map((d, i) => (d.getTime() - dates[i].getTime()) / 86400000);
        return diffs.reduce((s, n) => s + n, 0) / diffs.length;
    };

    const aggMetrics = (items: Procedure[]) => {
        const fKeys = ['fluoroscopy_time_minutes', 'fluoroscopy_time', 'fluoro_time', 'fluoroscopy_minutes', 'fluoroscopy_seconds'];
        const dKeys = ['fluoroscopy_dose_value', 'radiation_dose', 'dose', 'dlp'];
        const fv: number[] = [], dv: number[] = [];
        items.forEach(p => {
            const f = extractNumber(p, fKeys);
            if (f !== undefined) fv.push(f > 300 ? f / 60 : f);
            const d = extractNumber(p, dKeys);
            if (d !== undefined) dv.push(d);
        });
        return {
            avgFluoro: fv.length ? fv.reduce((s, n) => s + n, 0) / fv.length : undefined,
            avgDose: dv.length ? dv.reduce((s, n) => s + n, 0) / dv.length : undefined,
            count: items.length,
        };
    };

    const nameSummaries = useMemo(
        () =>
            Object.keys(groupedByName)
                .map(name => ({
                    name,
                    avgIntervalDays: avgIntervalForGroup(groupedByName[name]),
                    ...aggMetrics(groupedByName[name]),
                }))
                .sort((a, b) => b.count - a.count),
        [groupedByName]
    );

    const codeSummaries = useMemo(
        () =>
            Object.keys(groupedByCode)
                .map(code => ({
                    code,
                    avgIntervalDays: avgIntervalForGroup(groupedByCode[code]),
                    ...aggMetrics(groupedByCode[code]),
                }))
                .sort((a, b) => b.count - a.count),
        [groupedByCode]
    );

    const fmtMin  = (v?: number) => (v !== undefined ? `${v.toFixed(1)} min` : 'N/A');
    const fmtDose = (v?: number) => (v !== undefined ? `${v.toFixed(1)}` : 'N/A');
    const fmtDays = (v?: number) => (v !== undefined ? `${v.toFixed(1)} days` : 'N/A');

    const thL: React.CSSProperties = { textAlign: 'left',  padding: 8, color: 'rgba(55,65,81,0.9)' };
    const thR: React.CSSProperties = { textAlign: 'right', padding: 8, color: 'rgba(55,65,81,0.9)' };

    return (
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                background: '#fff',
                borderRadius: 12,
                padding: 18,
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                color: '#374151',
                fontSize: 13,
                flex: 1,         // fill remaining height in the right column flex container
                minHeight: 0,    // allow shrinking below content size
                minWidth: 0,
                overflow: 'hidden',
            }}
        >
            {/* ── Card title ── */}
            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 12, color: '#374151', flexShrink: 0 }}>
                Key Performance Metrics
            </div>

            {/* ── Section 1 header ── */}
            <div style={{ flexShrink: 0 }}>
                <div style={{ fontWeight: 600, marginBottom: 8, color: 'rgba(55,65,81,0.95)' }}>
                    Procedure Metrics Overview
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontSize: 13, color: 'rgba(55,65,81,0.9)', fontWeight: 600 }}>Filter</div>
                    <div style={{ position: 'relative', display: 'inline-block' }}>
                        <select
                            value={recentFilter}
                            onChange={e => setRecentFilter(e.target.value)}
                            style={{
                                padding: '6px 34px 6px 10px',
                                borderRadius: 8,
                                border: '1px solid rgba(0,0,0,0.12)',
                                background: 'rgba(175,213,240,0.04)',
                                fontWeight: 600,
                                cursor: 'pointer',
                                color: 'rgba(0,0,0,0.6)',
                                fontSize: 13,
                                WebkitAppearance: 'none',
                                MozAppearance: 'none',
                                appearance: 'none',
                            }}
                        >
                            {recentProcedureOptions.map(opt => (
                                <option key={opt.key} value={opt.key}>{opt.label}</option>
                            ))}
                        </select>
                        <svg viewBox="0 0 24 24" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, pointerEvents: 'none', color: 'rgba(74,144,226,1)' }} aria-hidden>
                            <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </div>
                </div>
            </div>

            {/* Scrollable recent-cases table */}
            <div style={{
                flex: '1 1 0',
                minHeight: 0,
                overflowY: 'auto',
                overflowX: 'hidden',
                border: '1px solid #eef2ff',
                borderRadius: 6,
                marginBottom: 16,
            }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ background: '#f8fafc', position: 'sticky', top: 0, zIndex: 1 }}>
                        <tr>
                            <th style={thL}>Date</th>
                            <th style={thL}>Procedure</th>
                            <th style={thR}>Fluoro Time</th>
                            <th style={thR}>Fluoro Dose</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={4} style={{ textAlign: 'center', padding: 12, color: 'rgba(55,65,81,0.6)' }}>Loading...</td></tr>
                        ) : recentCases.length === 0 ? (
                            <tr><td colSpan={4} style={{ textAlign: 'center', padding: 12, color: 'rgba(55,65,81,0.6)' }}>No cases</td></tr>
                        ) : recentCases.map((c: Procedure) => {
                            const date = toDate(c.create_date);
                            const displayDate = date
                                ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                : c.create_date;
                            const fluoro = extractNumber(c as any, ['fluoroscopy_time_minutes', 'fluoroscopy_time', 'fluoro_time', 'fluoroscopy_minutes', 'fluoroscopy_seconds']);
                            const fluoroMin = fluoro !== undefined ? (fluoro > 300 ? fluoro / 60 : fluoro) : undefined;
                            const dose = extractNumber(c as any, ['fluoroscopy_dose_value', 'radiation_dose', 'dose', 'dlp']);
                            return (
                                <tr key={(c as any).report_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                    <td style={{ padding: 8, color: 'rgba(55,65,81,0.85)' }}>{displayDate}</td>
                                    <td title={c.proc_desc || c.proc_code || 'Unknown'} style={{ padding: 8, color: 'rgba(55,65,81,0.85)' }}>{c.proc_desc || c.proc_code || 'Unknown'}</td>
                                    <td style={{ padding: 8, textAlign: 'right', color: 'rgba(55,65,81,0.85)' }}>{fluoroMin !== undefined ? `${fluoroMin.toFixed(1)} min` : '—'}</td>
                                    <td style={{ padding: 8, textAlign: 'right', color: 'rgba(55,65,81,0.85)' }}>{dose !== undefined ? dose.toFixed(1) : '—'}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* ── Section 2 header ── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexShrink: 0 }}>
                <div style={{ fontWeight: 600, color: 'rgba(55,65,81,0.95)' }}>Averages by Procedure</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div style={{ fontSize: 13, color: 'rgba(55,65,81,0.8)', fontWeight: 600, marginRight: 6 }}>View</div>
                    <div
                        onFocusCapture={() => setToggleFocusWithin(true)}
                        onBlurCapture={() => setToggleFocusWithin(false)}
                        style={{
                            position: 'relative',
                            width: 128,
                            height: 36,
                            borderRadius: 9999,
                            background: '#f3f4f6',
                            border: '1px solid #e6e7eb',
                            boxShadow: toggleFocusWithin ? '0 6px 18px rgba(59,130,246,0.08)' : undefined,
                        }}
                    >
                        <div aria-hidden style={{
                            position: 'absolute', top: 3, bottom: 3,
                            ...(viewMode === 'name' ? { left: 3, right: '50%' } : { right: 3, left: '50%' }),
                            borderRadius: 9999,
                            background: 'rgba(59,130,246,0.12)',
                            boxShadow: 'inset 0 0 0 1px rgba(59,130,246,0.14)',
                            transition: 'left 200ms cubic-bezier(.2,.9,.2,1), right 200ms cubic-bezier(.2,.9,.2,1)',
                        }} />
                        <div style={{ position: 'relative', display: 'flex', height: '100%', zIndex: 2 }}>
                            <button
                                aria-pressed={viewMode === 'name'}
                                onClick={() => setViewMode('name')}
                                style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 600, fontSize: 13, color: viewMode === 'name' ? '#0f172a' : '#475569', borderRadius: 9999 }}
                                onFocus={e => (e.currentTarget.style.outline = 'none')}
                                onBlur={e => (e.currentTarget.style.outline = 'none')}
                            >Name</button>
                            <button
                                aria-pressed={viewMode === 'code'}
                                onClick={() => setViewMode('code')}
                                style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 600, fontSize: 13, color: viewMode === 'code' ? '#0f172a' : '#475569', borderRadius: 9999 }}
                                onFocus={e => (e.currentTarget.style.outline = 'none')}
                                onBlur={e => (e.currentTarget.style.outline = 'none')}
                            >Code</button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Scrollable averages table */}
            <div style={{
                flex: '1 1 0',
                minHeight: 0,
                overflowY: 'auto',
                overflowX: 'hidden',
                border: '1px solid #eef2ff',
                borderRadius: 6,
            }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                    <thead style={{ background: '#f8fafc', position: 'sticky', top: 0, zIndex: 1 }}>
                        <tr>
                            <th style={thL}>{viewMode === 'name' ? 'Procedure' : 'Code'}</th>
                            <th style={thR}>Avg Interval</th>
                            <th style={thR}>Avg Fluoro Time</th>
                            <th style={thR}>Avg Fluoro Dose</th>
                            <th style={thR}>Count</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(viewMode === 'name' ? nameSummaries : codeSummaries).map((s: any) => (
                            <tr key={viewMode === 'name' ? s.name : s.code} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                <td title={viewMode === 'name' ? s.name : s.code} style={{ padding: 8, color: 'rgba(55,65,81,0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {viewMode === 'name' ? s.name : s.code}
                                </td>
                                <td style={{ padding: 8, textAlign: 'right', color: 'rgba(55,65,81,0.85)' }}>{fmtDays(s.avgIntervalDays)}</td>
                                <td style={{ padding: 8, textAlign: 'right', color: 'rgba(55,65,81,0.85)' }}>{fmtMin(s.avgFluoro)}</td>
                                <td style={{ padding: 8, textAlign: 'right', color: 'rgba(55,65,81,0.85)' }}>{fmtDose(s.avgDose)}</td>
                                <td style={{ padding: 8, textAlign: 'right', color: 'rgba(55,65,81,0.85)' }}>{s.count}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}