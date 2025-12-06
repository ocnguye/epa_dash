"use client";

import React, { useMemo, useState } from 'react';

type Procedure = {
    report_id: number;
    create_date: string; // 'YYYY-MM-DD' or ISO
    proc_desc?: string | null;
    proc_code?: string | null;
    // potential optional measurement fields (we'll try common names)
    // normalized / parsed fields (preferred)
    fluoroscopy_time_minutes?: number | string | null; // normalized minutes
    fluoroscopy_dose_value?: number | string | null; // normalized numeric dose (mGy or DLP depending on parsing)
    fluoroscopy_time_raw?: string | null;
    fluoroscopy_dose_unit?: string | null;
    // legacy / alternative names we may receive
    fluoroscopy_time?: number | string | null; // minutes
    fluoro_time?: number | string | null; // minutes
    fluoroscopy_minutes?: number | string | null;
    fluoroscopy_seconds?: number | string | null;
    radiation_dose?: number | string | null; // e.g., DAP or mGy
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

export default function KeyPerformanceMetrics({ procedures, loading }: { procedures: Procedure[]; loading: boolean }) {
    // helper to parse date
    const toDate = (d?: string) => {
        if (!d) return undefined;
        const dt = new Date(d);
        if (!isNaN(dt.getTime())) return dt;
        // try YYYY-MM-DD
        const parts = d.split('-');
        if (parts.length >= 3) {
            const y = Number(parts[0]);
            const m = Number(parts[1]) - 1;
            const day = Number(parts[2]);
            const dd = new Date(y, m, day);
            if (!isNaN(dd.getTime())) return dd;
        }
        return undefined;
    };

    // Per-case list (most recent 20)
    const [recentFilter, setRecentFilter] = useState<string>('all');

    // Build a sorted copy of procedures, then apply recent filter and limit to 20
    const recentCases = useMemo(() => {
        if (!procedures || procedures.length === 0) return [] as Procedure[];
        const list = procedures.slice().map(p => ({ ...p }));
        list.sort((a, b) => {
            const da = toDate(a.create_date)?.getTime() || 0;
            const db = toDate(b.create_date)?.getTime() || 0;
            return db - da;
        });
        const filtered = recentFilter && recentFilter !== 'all'
            ? list.filter(p => {
                const key = (p.proc_desc && String(p.proc_desc).trim()) || (p.proc_code && String(p.proc_code).trim()) || 'Unknown';
                return key === recentFilter;
            })
            : list;
        return filtered;
    }, [procedures, recentFilter]);

    // Options for recent-cases filter derived from available procedures
    const recentProcedureOptions = useMemo(() => {
        const map = new Map<string, string>();
        (procedures || []).forEach(p => {
            const key = (p.proc_desc && String(p.proc_desc).trim()) || (p.proc_code && String(p.proc_code).trim()) || 'Unknown';
            if (!map.has(key)) map.set(key, key);
        });
        return [{ key: 'all', label: 'All procedures' }, ...Array.from(map.keys()).map(k => ({ key: k, label: k }))];
    }, [procedures]);

    // Build groups by proc_desc and proc_code
    const groupedByName = useMemo(() => {
        const map: Record<string, Procedure[]> = {};
        (procedures || []).forEach(p => {
            const key = (p.proc_desc && String(p.proc_desc).trim()) || 'Unknown';
            map[key] = map[key] || [];
            map[key].push(p);
        });
        return map;
    }, [procedures]);

    const groupedByCode = useMemo(() => {
        const map: Record<string, Procedure[]> = {};
        (procedures || []).forEach(p => {
            const key = (p.proc_code && String(p.proc_code).trim()) || 'Unknown';
            map[key] = map[key] || [];
            map[key].push(p);
        });
        return map;
    }, [procedures]);

    // Average interval between procedures: compute per group (in days)
    const avgIntervalForGroup = (items: Procedure[]) => {
        if (!items || items.length < 2) return undefined;
        const dates = items.map(i => toDate(i.create_date)).filter(Boolean) as Date[];
        if (dates.length < 2) return undefined;
        dates.sort((a,b) => a.getTime() - b.getTime());
        const diffs: number[] = [];
        for (let i = 1; i < dates.length; i++) {
            const diffDays = (dates[i].getTime() - dates[i-1].getTime()) / (1000 * 60 * 60 * 24);
            diffs.push(diffDays);
        }
        if (diffs.length === 0) return undefined;
        const mean = diffs.reduce((s,n) => s+n, 0) / diffs.length;
        return mean;
    };

    // Aggregations for fluoro time and radiation dose
    const aggMetrics = (items: Procedure[]) => {
        // Prefer normalized minute field when available, then fall back to legacy names
        const fluoroKeys = ['fluoroscopy_time_minutes','fluoroscopy_time','fluoro_time','fluoroscopy_minutes','fluoroscopy_seconds'];
        // Prefer normalized dose numeric value when available
        const doseKeys = ['fluoroscopy_dose_value','radiation_dose','dose','dlp'];
        const fluoroVals: number[] = [];
        const doseVals: number[] = [];
        items.forEach(p => {
            const f = extractNumber(p, fluoroKeys);
            if (typeof f !== 'undefined') {
                // if the value came from a 'minutes' field it's already minutes. If it's a seconds value
                // we heuristically convert large numbers (>300) to minutes.
                const asMinutes = f > 300 ? f/60 : f; // heuristic: >300 units likely seconds
                fluoroVals.push(asMinutes);
            }
            const d = extractNumber(p, doseKeys);
            if (typeof d !== 'undefined') doseVals.push(d);
        });
        const avgFluoro = fluoroVals.length ? (fluoroVals.reduce((s,n)=>s+n,0) / fluoroVals.length) : undefined;
        const avgDose = doseVals.length ? (doseVals.reduce((s,n)=>s+n,0) / doseVals.length) : undefined;
        return { avgFluoro, avgDose, count: items.length };
    };

    const nameSummaries = useMemo(() => {
        const entries = Object.keys(groupedByName).map(name => {
            const items = groupedByName[name];
            return {
                name,
                avgIntervalDays: avgIntervalForGroup(items),
                ...aggMetrics(items),
            };
        });
        entries.sort((a,b) => (b.count || 0) - (a.count || 0));
        return entries;
    }, [groupedByName]);

    const codeSummaries = useMemo(() => {
        const entries = Object.keys(groupedByCode).map(code => {
            const items = groupedByCode[code];
            return {
                code,
                avgIntervalDays: avgIntervalForGroup(items),
                ...aggMetrics(items),
            };
        });
        entries.sort((a,b) => (b.count || 0) - (a.count || 0));
        return entries;
    }, [groupedByCode]);

    const formatMinutes = (v?: number) => typeof v === 'number' ? `${v.toFixed(1)} min` : 'N/A';
    const formatDose = (v?: number) => typeof v === 'number' ? `${v.toFixed(1)}` : 'N/A';
    const formatDays = (v?: number) => typeof v === 'number' ? `${v.toFixed(1)} days` : 'N/A';

    return (
        <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.1)', color: '#374151' }}>
            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 12, color: '#374151' }}>Key Performance Metrics</div>

            {/* Per-case details */}
            <div style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 600, marginBottom: 8, color: 'rgba(55,65,81,0.95)' }}>Procedure Metrics Overview</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <div style={{ fontSize: 13, color: 'rgba(55,65,81,0.9)', fontWeight: 600 }}>Filter</div>
                        <div style={{ position: 'relative', display: 'inline-block' }}>
                            <select
                                id="recent-procedure-filter"
                                value={recentFilter}
                                onChange={(e) => setRecentFilter(e.target.value)}
                                style={{
                                    padding: '6px 34px 6px 10px',
                                    borderRadius: 8,
                                    border: '1px solid rgba(0, 0, 0, 0.12)',
                                    background: 'rgba(175,213,240,0.04)',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    color: 'rgba(0, 0, 0, 0.6)',
                                    fontSize: 13,
                                    WebkitAppearance: 'none',
                                    MozAppearance: 'none',
                                    appearance: 'none',
                                    minWidth: 180
                                }}
                            >
                                {recentProcedureOptions.map(opt => (
                                    <option key={opt.key} value={opt.key}>{opt.label}</option>
                                ))}
                            </select>
                            <svg viewBox="0 0 24 24" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, pointerEvents: 'none', color: 'rgba(74,144,226,1)' }} xmlns="http://www.w3.org/2000/svg" aria-hidden>
                                <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </div>
                    </div>
                    <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #eef2ff', borderRadius: 6 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead style={{ background: '#f8fafc' }}>
                            <tr>
                                <th style={{ textAlign: 'left', padding: 8, color: 'rgba(55,65,81,0.9)' }}>Date</th>
                                <th style={{ textAlign: 'left', padding: 8, color: 'rgba(55,65,81,0.9)' }}>Procedure</th>
                                <th style={{ textAlign: 'right', padding: 8, color: 'rgba(55,65,81,0.9)' }}>Fluoro</th>
                                <th style={{ textAlign: 'right', padding: 8, color: 'rgba(55,65,81,0.9)' }}>Dose</th>
                            </tr>
                        </thead>
                        <tbody>
                                {loading ? (
                                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 12, color: 'rgba(55,65,81,0.6)' }}>Loading...</td></tr>
                            ) : recentCases.length === 0 ? (
                                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 12, color: 'rgba(55,65,81,0.6)' }}>No cases</td></tr>
                            ) : recentCases.map((c: Procedure) => {
                                const date = toDate(c.create_date);
                                const displayDate = date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : c.create_date;
                                // prefer normalized parsed fields when available
                                const fluoro = extractNumber(c as any, ['fluoroscopy_time_minutes','fluoroscopy_time','fluoro_time','fluoroscopy_minutes','fluoroscopy_seconds']);
                                const fluoroMin = typeof fluoro !== 'undefined' ? (fluoro > 300 ? fluoro/60 : fluoro) : undefined;
                                const dose = extractNumber(c as any, ['fluoroscopy_dose_value','radiation_dose','dose','dlp']);
                                return (
                                    <tr key={(c as any).report_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                        <td style={{ padding: 8, color: 'rgba(55,65,81,0.85)' }}>{displayDate}</td>
                                        <td style={{ padding: 8, color: 'rgba(55,65,81,0.85)' }}>{c.proc_desc || c.proc_code || 'Unknown'}</td>
                                        <td style={{ padding: 8, textAlign: 'right', color: 'rgba(55,65,81,0.85)' }}>{typeof fluoroMin === 'number' ? `${fluoroMin.toFixed(1)} min` : '—'}</td>
                                        <td style={{ padding: 8, textAlign: 'right', color: 'rgba(55,65,81,0.85)' }}>{typeof dose === 'number' ? dose.toFixed(1) : '—'}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Averages by procedure name */}
            <div style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 600, marginBottom: 8, color: 'rgba(55,65,81,0.95)' }}>Averages by Procedure</div>
                <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #eef2ff', borderRadius: 6 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead style={{ background: '#f8fafc' }}>
                            <tr>
                                <th style={{ textAlign: 'left', padding: 8, color: 'rgba(55,65,81,0.9)' }}>Procedure</th>
                                <th style={{ textAlign: 'right', padding: 8, color: 'rgba(55,65,81,0.9)' }}>Avg Interval</th>
                                <th style={{ textAlign: 'right', padding: 8, color: 'rgba(55,65,81,0.9)' }}>Avg Fluoro</th>
                                <th style={{ textAlign: 'right', padding: 8, color: 'rgba(55,65,81,0.9)' }}>Avg Dose</th>
                                <th style={{ textAlign: 'right', padding: 8, color: 'rgba(55,65,81,0.9)' }}>Count</th>
                            </tr>
                        </thead>
                        <tbody>
                            {nameSummaries.map(s => (
                                <tr key={s.name} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                    <td style={{ padding: 8, color: 'rgba(55,65,81,0.85)' }}>{s.name}</td>
                                    <td style={{ padding: 8, textAlign: 'right', color: 'rgba(55,65,81,0.85)' }}>{formatDays(s.avgIntervalDays)}</td>
                                    <td style={{ padding: 8, textAlign: 'right', color: 'rgba(55,65,81,0.85)' }}>{formatMinutes(s.avgFluoro)}</td>
                                    <td style={{ padding: 8, textAlign: 'right', color: 'rgba(55,65,81,0.85)' }}>{formatDose(s.avgDose)}</td>
                                    <td style={{ padding: 8, textAlign: 'right', color: 'rgba(55,65,81,0.85)' }}>{s.count}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Averages by procedure code/type */}
            <div>
                <div style={{ fontWeight: 600, marginBottom: 8, color: 'rgba(55,65,81,0.95)' }}>Averages by Procedure Type (Code)</div>
                <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #eef2ff', borderRadius: 6 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead style={{ background: '#f8fafc' }}>
                            <tr>
                                <th style={{ textAlign: 'left', padding: 8, color: 'rgba(55,65,81,0.9)' }}>Code</th>
                                <th style={{ textAlign: 'right', padding: 8, color: 'rgba(55,65,81,0.9)' }}>Avg Interval</th>
                                <th style={{ textAlign: 'right', padding: 8, color: 'rgba(55,65,81,0.9)' }}>Avg Fluoro</th>
                                <th style={{ textAlign: 'right', padding: 8, color: 'rgba(55,65,81,0.9)' }}>Avg Dose</th>
                                <th style={{ textAlign: 'right', padding: 8, color: 'rgba(55,65,81,0.9)' }}>Count</th>
                            </tr>
                        </thead>
                        <tbody>
                            {codeSummaries.map(s => (
                                <tr key={s.code} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                    <td style={{ padding: 8, color: 'rgba(55,65,81,0.85)' }}>{s.code}</td>
                                    <td style={{ padding: 8, textAlign: 'right', color: 'rgba(55,65,81,0.85)' }}>{formatDays(s.avgIntervalDays)}</td>
                                    <td style={{ padding: 8, textAlign: 'right', color: 'rgba(55,65,81,0.85)' }}>{formatMinutes(s.avgFluoro)}</td>
                                    <td style={{ padding: 8, textAlign: 'right', color: 'rgba(55,65,81,0.85)' }}>{formatDose(s.avgDose)}</td>
                                    <td style={{ padding: 8, textAlign: 'right', color: 'rgba(55,65,81,0.85)' }}>{s.count}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
