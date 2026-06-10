"use client";

import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import CohortStrengthsWeaknesses, { ProcedureStat } from '../../../../components/CohortStrengthsWeaknesses';
import ReportProgressCircle from '../../../../components/ReportProgressCircle';

import { 
    Chart as ChartJS, 
    CategoryScale, 
    LinearScale, 
    PointElement, 
    LineElement, 
    BarElement, 
    Title, 
    Tooltip, 
    Legend,
    Filler,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import ChartTrendline from 'chartjs-plugin-trendline';
import ProgressCircle from '../../../../components/ProgressCircle';
import { epaTrendOptions, procedureSpecificOptions, hoverSlopePlugin } from '../../../../components/ChartConfigs';

ChartJS.register(
    CategoryScale, 
    LinearScale, 
    PointElement, 
    LineElement, 
    BarElement, 
    Title, 
    Tooltip, 
    Legend,
    Filler,
    ChartTrendline,
    hoverSlopePlugin,
);

export default function TraineePage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const router = useRouter();
    const [resolvedId, setResolvedId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [user, setUser] = useState<any>(null);
    const [procedures, setProcedures] = useState<any[]>([]);
    const [stats, setStats] = useState<any>(null);
    const [procSortAsc, setProcSortAsc] = useState(true);
    const chartContainerRef = useRef<HTMLDivElement | null>(null);
    const [chartInnerWidth, setChartInnerWidth] = useState<number>(0);

    useEffect(() => {
        if (!params || !(params as any).id) return;
        setResolvedId(String((params as any).id));
    }, [params]);

    useEffect(() => {
        if (!resolvedId) return;
        const load = async () => {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch(`/api/attendingepa/trainees/${resolvedId}`, {
                    credentials: 'same-origin',
                    headers: { Accept: 'application/json' },
                });
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    setError(body?.message || 'Failed to load trainee');
                    setLoading(false);
                    return;
                }
                const data = await res.json();
                setUser(data.user || null);
                setProcedures(data.procedures || []);
                setStats(data.stats || null);
            } catch (err: any) {
                setError(err?.message || 'Server error');
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [resolvedId]);

    const traineeLocalProcedures = useMemo((): ProcedureStat[] => {
        if (!procedures || procedures.length === 0) return [];
        const statsMap: Record<string, { sum: number; count: number; desc: string; code: string }> = {};
        procedures.forEach((p: any) => {
            const desc = p.proc_desc ? String(p.proc_desc).trim() : '';
            const code = p.proc_code ? String(p.proc_code).trim() : '';
            const key = desc || code || 'Unknown';
            const oepa = Number(p.oepa);
            if (!statsMap[key]) statsMap[key] = { sum: 0, count: 0, desc: desc || 'Unknown', code: code || '' };
            if (Number.isFinite(oepa) && oepa > 0) {
                statsMap[key].sum += oepa;
                statsMap[key].count += 1;
            }
        });
        return Object.values(statsMap)
            .filter(s => s.count > 0)  // add this
            .map(s => ({
                desc: s.desc,
                code: s.code,
                avg_epa: s.count ? s.sum / s.count : 0,
                count: s.count,
            }));
        }, [procedures]);
    
    // grabbing cohort avg EPA from URL (passed by parent component)
    const cohortAvgEpa = useMemo(() => {
        const raw = searchParams.get('ca');
        if (!raw) return 0;
        try {
            const decoded = atob(raw);
            const v = Number(decoded);
            return Number.isFinite(v) && v > 0 ? v : 0;
        } catch {
            return 0;
        }
    }, [searchParams]);

    const epaTrendData = useMemo(() => {
        if (!procedures || procedures.length === 0) return null;

        const valid = procedures.filter((p: any) => {
            const v = Number(p.oepa);
            return Number.isFinite(v) && v > 0;
        });
        if (!valid.length) return null;

        const sorted = [...valid].sort((a: any, b: any) =>
            new Date(a.create_date).getTime() - new Date(b.create_date).getTime()
        );

        const fmtDay = (d: Date) => d.toISOString().slice(0, 10);
        const map: Record<string, { sum: number; count: number }> = {};
        const orderedKeys: string[] = [];

        sorted.forEach((p: any) => {
            const k = fmtDay(new Date(p.create_date));
            if (!map[k]) {
                map[k] = { sum: 0, count: 0 };
                orderedKeys.push(k);
            }
            map[k].sum += Number(p.oepa);
            map[k].count += 1;
        });

        const labels = orderedKeys.map(k => {
            const [y, m, d] = k.split('-');
            return new Date(Number(y), Number(m) - 1, Number(d))
                .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        });

        const epaData = orderedKeys.map(k =>
            Number((map[k].sum / map[k].count).toFixed(2))
        );

        const datasets: any[] = [
            {
                label: 'EPA Score',
                data: epaData,
                timestamps: orderedKeys,
                borderColor: '#afd5f0',
                backgroundColor: 'rgba(74, 144, 226, 0.1)',
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#afd5f0',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 6,
                trendlineLinear: {
                    colorMin: 'rgba(178, 211, 194, 0.6)',
                    colorMax: 'rgba(178, 211, 194, 0.6)',
                    lineStyle: 'dotted',
                    width: 2,
                },
            }
        ];

        if (cohortAvgEpa > 0) {
            datasets.push({
                label: 'Peer Cohort',
                data: labels.map(() => cohortAvgEpa),
                cohortValue: cohortAvgEpa,
                cohortPgy: user?.pgy ?? null,
                borderColor: '#ffe26c',
                backgroundColor: 'rgba(255, 226, 108, 0.12)',
                borderWidth: 2,
                fill: false,
                tension: 0,
                borderDash: [6, 4],
                pointRadius: 0,
                pointHoverRadius: 10,
                pointHitRadius: 10,
                hoverBorderWidth: 2,
            });
        }

        return { labels, datasets };
    }, [procedures, cohortAvgEpa, user]); 

  const procedureSpecificData = useMemo(() => {
    if (!procedures || procedures.length === 0) return null;

    const statsMap: Record<string, { sum: number; count: number; desc?: string; code?: string }> = {};
    procedures.forEach((p: any) => {
        const desc = p.proc_desc ? String(p.proc_desc).trim() : '';
        const code = p.proc_code ? String(p.proc_code).trim() : '';
        const key = desc || code || 'Unknown';
        const oepa = Number(p.oepa);
        if (!statsMap[key]) statsMap[key] = { sum: 0, count: 0, desc: desc || code || 'Unknown', code };
        if (Number.isFinite(oepa) && oepa > 0) {
            statsMap[key].sum += oepa;
            statsMap[key].count += 1;
        }
    });

    const truncate = (txt: string, n = 30) => txt && txt.length > n ? txt.slice(0, n - 1).trim() + '…' : txt;

    const sortedEntries = Object.values(statsMap)
        .filter(stat => stat.count > 0)
        .sort((a, b) => {
        const avgA = a.count ? a.sum / a.count : 0;
        const avgB = b.count ? b.sum / b.count : 0;
        return procSortAsc ? avgA - avgB : avgB - avgA;
    });

    const trimProcedureName = (name: string, maxLength = 20): string => {
        const stripped = name.replace(/^\s*(IR|CT)\s+/i, '').trim();
        return stripped.length > maxLength ? stripped.slice(0, maxLength - 1) + '…' : stripped;
    };

    const labels = sortedEntries.map(e => trimProcedureName(e.desc || e.code || 'Unknown'));
    const descriptions = sortedEntries.map(s => s.desc || '');
    const counts = sortedEntries.map(s => s.count || 0);
    const averages = sortedEntries.map(s => s.count ? Number((s.sum / s.count).toFixed(1)) : 0);

    const colors = [
        'rgba(175, 213, 240, 0.6)',
        'rgba(178, 211, 194, 0.6)',
        'rgba(255, 126, 112, 0.6)',
        'rgba(200, 206, 238, 0.6)',
        'rgba(255, 226, 108, 0.6)',
    ];
    const borders = ['#afd5f0', '#b2d3c2', '#ff7e70', '#c8ceee', '#ffe26c'];

    return {
        labels,
        datasets: [{
            label: 'Average EPA Score',
            data: averages,
            descriptions,
            counts,
            backgroundColor: labels.map((_, i) => colors[i % colors.length]),
            borderColor: labels.map((_, i) => borders[i % borders.length]),
            borderWidth: 2,
        }]
    };
  }, [procedures, procSortAsc]);

  return (
      <div style={{ minHeight: '100vh', width: '100%', background: 'linear-gradient(135deg, #c8ceee 30%, #a7abde 100%)', fontFamily: 'Ubuntu, sans-serif', padding: 24, boxSizing: 'border-box' }}>
          <div style={{ width: '100%', margin: 0 }}>
              {/* Header */}
              <div style={{ background: '#fff', borderRadius: 16, padding: 24, marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                      <h1 style={{ fontSize: 32, fontWeight: 700, margin: '0 0 8px 0', color: '#000' }}>
                          {user ? (
                              `Trainee Drill Down Page: ${((user as any)?.preferred_name && String((user as any).preferred_name).trim()) ? String((user as any).preferred_name).trim() + ' ' + (user.last_name || '') : `${user.first_name || ''} ${user.last_name || ''}`}`
                          ) : 'Trainee Drill Down Page'}
                      </h1>
                      <div style={{ color: '#666', fontSize: 16 }}>
                          {user ? (
                              <>
                                  <strong>Trainee:</strong>
                                  <span>{` ${((user as any)?.preferred_name && String((user as any).preferred_name).trim()) ? String((user as any).preferred_name).trim() : user.first_name} ${user.last_name}`}</span>
                                  <span>{' | '}</span>
                                  <strong>PGY:</strong>
                                  <span>{` ${(user as any)?.pgy != null ? (user as any).pgy : ''}`}</span>
                                  <span>{' | '}</span>
                                  <strong>Specialty:</strong>
                                  <span>{' Interventional Radiology'}</span>
                              </>
                          ) : (
                              'Loading user info...'
                          )}
                      </div>
                  </div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <button onClick={() => router.push('/attendingepa')} style={{ background: '#fff', color: '#374151', border: '1px solid rgba(55,65,81,0.08)', borderRadius: 8, padding: '10px 14px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Back to Trainees</button>
                  </div>
              </div>

              {/* Main Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, marginTop: 18, alignItems: 'stretch' }}>

                  {/* Left Column */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minHeight: 0, minWidth: 0, overflow: 'hidden' }}>

                      {/* Overall EPA Trajectory */}
                      <div style={{ background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12, color: '#374151' }}>Overall EPA Trajectory</div>
                          {loading ? (
                              <div style={{ flex: 1, minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading...</div>
                          ) : epaTrendData ? (
                              <div style={{ flex: 1, minHeight: 120 }}>
                                  <Line
                                      data={epaTrendData as any}
                                      options={{
                                          ...epaTrendOptions as any,
                                          interaction: { mode: 'index', intersect: false, axis: 'x' },
                                          plugins: {
                                              ...(epaTrendOptions as any).plugins,
                                              hoverSlopeLine: {},
                                          },
                                      }}
                                  />
                              </div>
                          ) : (
                              <div style={{ flex: 1, minHeight: 120, color: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>No EPA data available</div>
                          )}
                      </div>

                      {/* Procedure-Specific EPA Progression */}
                      <div
                          ref={chartContainerRef}
                          style={{
                              background: '#fff',
                              borderRadius: 12,
                              padding: 18,
                              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                              display: 'flex',
                              flexDirection: 'column',
                              flex: 1,
                              minHeight: 0,
                              minWidth: 0,
                              overflow: 'hidden',
                          }}
                      >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                              <div style={{ fontWeight: 700, fontSize: 16, color: '#374151' }}>Procedure-Specific EPA Progression</div>
                              <button
                                  onClick={() => setProcSortAsc(prev => !prev)}
                                  style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 6,
                                      padding: '6px 12px',
                                      borderRadius: 8,
                                      border: '1px solid rgba(0, 0, 0, 0.3)',
                                      background: 'rgba(175,213,240,0.06)',
                                      fontWeight: 600,
                                      cursor: 'pointer',
                                      color: 'rgba(0, 0, 0, 0.6)',
                                      fontSize: 13,
                                  }}
                              >
                                  {procSortAsc ? (
                                      <>
                                          Low → High
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                              <line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>
                                          </svg>
                                      </>
                                  ) : (
                                      <>
                                          High → Low
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                              <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
                                          </svg>
                                      </>
                                  )}
                              </button>
                          </div>
                          {loading ? (
                              <div style={{ flex: 1, minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading...</div>
                          ) : procedureSpecificData ? (
                              (() => {
                                  const barCount = procedureSpecificData.labels?.length ?? 0;
                                  const chartWidth = Math.max(barCount * 90, 600);
                                  const containerWidth = chartInnerWidth || 600;
                                  return (
                                    <div style={{
                                        width: '100%',
                                        overflowX: 'auto',
                                        overflowY: 'hidden',
                                        flex: 1,
                                        minHeight: 0,
                                    }}>
                                        <div style={{ position: 'relative', width: chartWidth, height: 420, minHeight: 300 }}>
                                            <Bar data={procedureSpecificData as any} options={procedureSpecificOptions as any} />
                                        </div>
                                    </div>
                                );
                              })()
                          ) : (
                              <div style={{ flex: 1, minHeight: 120, color: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>No procedure-specific data</div>
                          )}
                      </div>

                  </div>{/* end left column */}

                  {/* Right Column */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0, alignSelf: 'flex-start', width: '100%' }}>

                        {/* Report Progress Circle */}
                        <ReportProgressCircle
                            completed={stats?.total_reports || 0}
                            total={1000}
                            loading={loading}
                        />

                        {/* Performance Summary */}
                        <div style={{ background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12, color: '#374151' }}>Performance Summary</div>
                            {stats ? (
                                <div style={{ color: '#374151', fontSize: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <div><strong>Average EPA:</strong> {stats.avg_epa ? Number(stats.avg_epa).toFixed(2) : 'N/A'}</div>
                                    <div><strong>Procedures This Month:</strong> {stats.procedures || 0}</div>
                                    <div><strong>Pending Feedback:</strong> {stats.feedback_requested || 0}</div>
                                    <div><strong>Feedback Discussed:</strong> {stats.feedback_discussed || 0}</div>
                                </div>
                            ) : (
                                <div style={{ color: '#6b7280' }}>No summary available</div>
                            )}
                        </div>

                        {/* Strengths & Improvements */}
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <div style={{
                                background: '#6b7280',
                                color: '#fff',
                                fontWeight: 600,
                                fontSize: 14,
                                padding: '10px 16px',
                                borderRadius: '8px 8px 0 0',
                                boxShadow: '0 -2px 8px rgba(0,0,0,0.15)',
                                border: '1px solid rgba(107, 114, 128, 0.5)',
                                borderBottom: 'none',
                                textAlign: 'center' as const,
                            }}>
                                Strengths &amp; Improvements
                            </div>
                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 0,
                                background: '#fff',
                                borderRadius: '0 0 12px 12px',
                                border: '1px solid rgba(107, 114, 128, 0.5)',
                                borderTop: 'none',
                                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                                overflow: 'hidden',
                            }}>
                                <div style={{ padding: 12, borderBottom: '1px solid #f1f1f3' }}>
                                    <div style={{ height: 280}}>
                                        <CohortStrengthsWeaknesses
                                            mode="strengths"
                                            localProcedures={traineeLocalProcedures}
                                        />
                                    </div>
                                </div>
                                <div style={{ padding: 12 }}>
                                    <div style={{ height: 280 }}>
                                        <CohortStrengthsWeaknesses
                                            mode="weaknesses"
                                            localProcedures={traineeLocalProcedures}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>{/* end right column */}
              </div>{/* end main grid */}
          </div>
      </div>
  );
}