"use client";

import React, { useEffect, useState, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import ProgressCircle from '../../../../components/ProgressCircle';
import { epaTrendOptions, procedureSpecificOptions } from '../../../../components/ChartConfigs';


ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend);

export default function TraineePage() {
  // useParams() is the client-safe way to read dynamic route params in a client component
  const params = useParams();
  const router = useRouter();
  const [resolvedId, setResolvedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [procedures, setProcedures] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    // params from useParams() will be an object like { id: string }
    if (!params || !(params as any).id) return;
    setResolvedId(String((params as any).id));
  }, [params]);

  useEffect(() => {
    if (!resolvedId) return;
        const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/adminepa/trainees/${resolvedId}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
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

  const epaTrendData = useMemo(() => {
    if (!procedures || procedures.length === 0) return null;
    const sorted = [...procedures].sort((a,b) => new Date(a.create_date).getTime() - new Date(b.create_date).getTime());
    return {
      labels: sorted.map((p:any) => new Date(p.create_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
      datasets: [{
        label: 'EPA Score',
        data: sorted.map((p:any) => Number(p.oepa) || 0),
        borderColor: '#afd5f0',
        backgroundColor: 'rgba(74,144,226,0.08)',
        borderWidth: 3,
        tension: 0.3,
        fill: true,
        pointBackgroundColor: '#afd5f0',
        pointBorderColor: '#fff',
        pointRadius: 5,
      }]
    };
  }, [procedures]);

  const procedureSpecificData = useMemo(() => {
    if (!procedures || procedures.length === 0) return null;
  const statsMap: Record<string, { sum:number; count:number; desc?:string; code?: string }> = {};
    procedures.forEach((p:any) => {
      const desc = p.proc_desc ? String(p.proc_desc).trim() : '';
      const code = p.proc_code ? String(p.proc_code).trim() : '';
      const key = desc || code || 'Unknown';
      const oepa = Number(p.oepa);
      if (!statsMap[key]) statsMap[key] = { sum:0, count:0, desc: desc || code || 'Unknown', code };
      if (Number.isFinite(oepa) && oepa > 0) {
        statsMap[key].sum += oepa;
        statsMap[key].count += 1;
      }
    });
  const entries = Object.values(statsMap);
  const descriptions = entries.map(s => s.desc || '');
  const truncate = (txt: string, n = 30) => txt && txt.length > n ? txt.slice(0, n - 1).trim() + '…' : txt;
  const labels = entries.map(e => (e.code && e.code !== 'Unknown') ? e.code : truncate(String(e.desc || 'Unknown'), 30));
    const counts = Object.values(statsMap).map(s => s.count || 0);
    const averages = Object.values(statsMap).map(s => s.count ? Number((s.sum / s.count).toFixed(1)) : 0);
    return {
      labels,
      datasets: [{
        label: 'Average EPA Score',
        data: averages,
        descriptions,
        counts,
        backgroundColor: labels.map(() => 'rgba(175,213,240,0.6)'),
        borderColor: labels.map(() => '#afd5f0'),
        borderWidth: 2,
      }]
    };
  }, [procedures]);

  const strengthsWeaknesses = useMemo(() => {
    if (!procedureSpecificData) return { strengths: [], weaknesses: [] };
    const items = procedureSpecificData.labels.map((label, i) => ({ label, avg: (procedureSpecificData.datasets[0] as any).data[i], count: (procedureSpecificData.datasets[0] as any).counts[i], desc: (procedureSpecificData.datasets[0] as any).descriptions[i] }));
    const sorted = items.slice().sort((a,b) => (b.avg || 0) - (a.avg || 0));
    return { strengths: sorted.slice(0,3), weaknesses: sorted.slice(-3).reverse() };
  }, [procedureSpecificData]);

  return (
    <div style={{ minHeight: '100vh', width: '100vw', background: 'linear-gradient(135deg, #c8ceee 30%, #a7abde 100%)', fontFamily: 'Ubuntu, sans-serif', padding: 24, boxSizing: 'border-box' }}>
  <div style={{ width: '100%', margin: 0 }}>
        <div style={{ background: '#fff', borderRadius: 16, padding: 24, marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: 32, fontWeight: 700, margin: '0 0 8px 0', color: '#000' }}>
              {user ? (
                // prefer a trainee's preferred/given name but always include last name
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
            <button onClick={() => router.push('/adminepa')} style={{ background: '#fff', color: '#374151', border: '1px solid rgba(55,65,81,0.08)', borderRadius: 8, padding: '10px 14px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Back to Trainees</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, marginTop: 18, alignItems: 'stretch' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%', minHeight: 0 }}>
            <div style={{ background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12, color: '#374151' }}>Overall EPA Trajectory</div>
              {loading ? (
                <div style={{ flex: 1, minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading...</div>
              ) : epaTrendData ? (
                <div style={{ flex: 1, minHeight: 120 }}>
                  <Line data={epaTrendData as any} options={epaTrendOptions as any} />
                </div>
              ) : (
                <div style={{ flex: 1, minHeight: 120, color: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>No EPA data available</div>
              )}
            </div>
            <div style={{ background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12, color: '#374151' }}>Procedure-Specific EPA Progression</div>
              {loading ? (
                <div style={{ flex: 1, minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading...</div>
              ) : procedureSpecificData ? (
                <div style={{ flex: 1, minHeight: 120 }}>
                  <Bar data={procedureSpecificData as any} options={procedureSpecificOptions as any} />
                </div>
              ) : (
                <div style={{ flex: 1, minHeight: 120, color: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>No procedure-specific data</div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', textAlign: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12, color: '#374151' }}>Performance Summary</div>
              {stats ? (
                <>
                  <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center' }}>
                    <ProgressCircle requestedCount={stats.feedback_requested || 0} discussedCount={stats.feedback_discussed || 0} notRequiredCount={Math.max(0, (stats.total_reports || 0) - (stats.feedback_requested || 0) - (stats.feedback_discussed || 0))} totalCount={stats.total_reports || 0} size={180} strokeWidth={12} loading={loading} />
                  </div>
                  <div style={{ textAlign: 'left', color: '#374151', fontSize: 14 }}>
                    <div><strong>Average EPA:</strong> {(stats.avg_epa || 0).toFixed ? stats.avg_epa.toFixed(2) : stats.avg_epa}</div>
                    <div><strong>Total Reports:</strong> {stats.total_reports || 0}</div>
                    <div><strong>Procedures this month:</strong> {stats.procedures || 0}</div>
                  </div>
                </>
              ) : (
                <div style={{ color: '#6b7280' }}>No summary available</div>
              )}
            </div>

            <div style={{ background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12, color: '#374151' }}>Strengths & Improvements</div>
              {procedureSpecificData ? (
                <div>
                  <div style={{ marginBottom: 12, color: '#9CA3AF' }}><strong>Top Strengths</strong></div>
                  <div aria-label="top-strengths-list" style={{ maxHeight: 220, overflowY: 'auto', paddingRight: 6 }}>
                    {strengthsWeaknesses.strengths.length ? strengthsWeaknesses.strengths.map((s:any, idx:number) => (
                      <div key={'s'+idx} style={{ padding: '8px 6px', borderBottom: '1px solid #f1f1f3' }}>
                        <div style={{ fontWeight: 700, color: '#374151', fontSize: 13 }}>{s.desc || s.label}</div>
                        <div style={{ color: '#374151', fontSize: 12 }}>{s.count} reports — avg EPA {s.avg}</div>
                      </div>
                    )) : <div style={{ color: '#6b7280', padding: '8px 6px' }}>No strengths identified</div>}
                  </div>

                  <div style={{ marginTop: 12, marginBottom: 12, color: '#9CA3AF' }}><strong>Areas to Improve</strong></div>
                  <div aria-label="areas-to-improve-list" style={{ maxHeight: 220, overflowY: 'auto', paddingRight: 6 }}>
                    {strengthsWeaknesses.weaknesses.length ? strengthsWeaknesses.weaknesses.map((w:any, idx:number) => (
                      <div key={'w'+idx} style={{ padding: '8px 6px', borderBottom: '1px solid #f1f1f3' }}>
                        <div style={{ fontWeight: 700, color: '#374151', fontSize: 13 }}>{w.desc || w.label}</div>
                        <div style={{ color: '#374151', fontSize: 12 }}>{w.count} reports — avg EPA {w.avg}</div>
                      </div>
                    )) : <div style={{ color: '#6b7280', padding: '8px 6px' }}>No areas identified</div>}
                  </div>
                </div>
              ) : (
                <div style={{ color: '#6b7280' }}>No procedure data to analyze</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
