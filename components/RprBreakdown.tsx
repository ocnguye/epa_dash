"use client";

import React, { useEffect, useState } from 'react';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { Pie } from 'react-chartjs-2';

ChartJS.register(ArcElement, Tooltip, Legend);

type Row = {
  group: string;
  total_with_rpr: number;
  disagree_count: number;
  disagree_percent: number;
};

export default function RprBreakdown() {
  const [score, setScore] = useState<number | null>(4);
  const [groupBy, setGroupBy] = useState<'procedure_name' | 'modality' | 'patient_class'>('procedure_name');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    const q = [] as string[];
    if (score !== null) q.push(`score=${score}`);
    if (groupBy) q.push(`groupBy=${groupBy}`);
    const url = `/api/rpr/breakdown${q.length ? '?' + q.join('&') : ''}`;

    fetch(url)
      .then(r => r.json())
      .then((payload) => {
        if (!mounted) return;
        if (payload && payload.success && payload.data) {
          setRows(payload.data.groups || []);
        } else {
          setError(payload?.message || 'Unexpected response');
        }
      })
      .catch(e => setError(String(e?.message || e)))
      .finally(() => { if (mounted) setLoading(false); });

    return () => { mounted = false; };
  }, [score, groupBy]);

  // Make the whole breakdown box larger (wider/taller) while keeping the pie smaller so text isn't cut off.
  // Caller layout may constrain width; minWidth provides a desired target when space allows.
  const containerStyle: React.CSSProperties = {
    background: '#fff',
    borderRadius: 12,
    padding: 12,
    boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    boxSizing: 'border-box',
    overflow: 'hidden',
  };

  // color theme provided by user
  const backgroundColor = [
    'rgba(175, 213, 240, 0.6)',
    'rgba(178, 211, 194, 0.6)',
    'rgba(255, 126, 112, 0.6)',
    'rgba(200, 206, 238, 0.6)',
    'rgba(255, 226, 108, 0.6)'
  ];
  const borderColor = ['#afd5f0', '#b2d3c2', '#ff7e70', '#c8ceee', '#ffe26c'];

  // prepare chart data: prefer disagree_count (matches selected score), fallback to total_with_rpr
  const values = rows.map(r => r.disagree_count || r.total_with_rpr);
  const labels = rows.map(r => r.group);

  // if all values zero, show total_with_rpr instead (already handled above) but detect empty
  const totalSum = values.reduce((s, v) => s + (Number(v) || 0), 0);

  const data = {
    labels,
    datasets: [
      {
        label: 'Count',
        data: values,
        backgroundColor: labels.map((_, i) => backgroundColor[i % backgroundColor.length]),
        borderColor: labels.map((_, i) => borderColor[i % borderColor.length]),
        borderWidth: 1,
      },
    ],
  };

  const options: any = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      // disable the built-in legend so the adjacent list controls labeling and avoids overlap
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: any) => {
            const idx = ctx.dataIndex;
            const label = ctx.label || '';
            const val = ctx.dataset.data[idx] || 0;
            const pct = totalSum > 0 ? ((Number(val) / totalSum) * 100).toFixed(2) : '0.00';
            return `${label}: ${val} (${pct}%)`;
          }
        }
      }
    },
    cutout: '60%'
  };

  return (
    <div style={containerStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#374151' }}>RPR Breakdown</div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'inline-block' }}>
            <label htmlFor="rpr-breakdown-groupby" style={{ fontSize: 12, fontWeight: 700, marginRight: 8, color: '#374151' }}>Group</label>
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <select
                id="rpr-breakdown-groupby"
                value={groupBy}
                onChange={e => setGroupBy(e.target.value as any)}
                style={{
                  padding: '6px 34px 6px 10px',
                  borderRadius: 8,
                  border: '1px solid rgba(0, 0, 0, 0.3)',
                  background: 'rgba(175,213,240,0.06)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  color: '#374151',
                  fontSize: 13,
                  WebkitAppearance: 'none',
                  MozAppearance: 'none',
                  appearance: 'none'
                }}
              >
                <option value="procedure_name">ProcedureName</option>
                <option value="modality">Modality</option>
                <option value="patient_class">PatientClass</option>
              </select>
              <svg viewBox="0 0 24 24" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, pointerEvents: 'none', color: 'rgba(74,144,226,1)' }} xmlns="http://www.w3.org/2000/svg" aria-hidden>
                <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>

          <div style={{ display: 'inline-block' }}>
            <label htmlFor="rpr-breakdown-score" style={{ fontSize: 12, fontWeight: 700, marginRight: 8, color: '#374151' }}>RPR</label>
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <select
                id="rpr-breakdown-score"
                value={score === null ? '0' : String(score)}
                onChange={e => setScore(Number(e.target.value) === 0 ? null : Number(e.target.value))}
                style={{
                  padding: '6px 34px 6px 10px',
                  borderRadius: 8,
                  border: '1px solid rgba(0, 0, 0, 0.3)',
                  background: 'rgba(175,213,240,0.06)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  color: '#374151',
                  fontSize: 13,
                  WebkitAppearance: 'none',
                  MozAppearance: 'none',
                  appearance: 'none'
                }}
              >
                <option value="0">All</option>
                <option value="1">RPR1</option>
                <option value="2">RPR2</option>
                <option value="3">RPR3</option>
                <option value="4">RPR4</option>
              </select>
              <svg viewBox="0 0 24 24" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, pointerEvents: 'none', color: 'rgba(74,144,226,1)' }} xmlns="http://www.w3.org/2000/svg" aria-hidden>
                <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 12 }}>Loading…</div>
      ) : error ? (
        <div style={{ padding: 12, color: 'red' }}>{error}</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 12, color: '#6b7280' }}>No data</div>
      ) : (
        // content area: left chart column has fixed basis, right column flexes and stays within container
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', width: '100%' }}>
          <div style={{ flex: '0 0 320px', display: 'flex', alignItems: 'center', justifyContent: 'center', paddingRight: 8 }}>
            <div style={{ width: 240, height: 240 }}>
              <Pie data={data as any} options={options} />
            </div>
          </div>
          <div style={{ flex: '1 1 auto', maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, paddingRight: 8, minWidth: 0 }}>
            {rows.map((r, i) => {
              const val = Number(r.disagree_count || r.total_with_rpr || 0);
              const pct = totalSum > 0 ? (val / totalSum) * 100 : Number(r.disagree_percent || 0);
              const pctLabel = `${pct.toFixed(1)}%`;
              return (
                <div key={r.group} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <div style={{ width: 12, height: 12, borderRadius: 3, background: backgroundColor[i % backgroundColor.length], border: `1px solid ${borderColor[i % borderColor.length]}`, flex: '0 0 12px' }} />
                      <div style={{ fontSize: 13, color: '#374151', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 }}>{r.group}</div>
                    </div>
                    <div style={{ textAlign: 'right', flex: '0 0 70px' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>{val}</div>
                      <div style={{ fontSize: 12, color: '#374151' }}>{pctLabel}</div>
                    </div>
                  </div>

                  <div style={{ height: 10, background: '#f1f5f9', borderRadius: 6, overflow: 'hidden' }} aria-hidden>
                    <div style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: '100%', background: backgroundColor[i % backgroundColor.length], border: `1px solid ${borderColor[i % borderColor.length]}` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
