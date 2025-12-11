"use client";

import React, { useEffect, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { Chart } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip, Legend);

type PointRow = {
  label: string; // YYYY-MM-DD
  total_reports: number;
  disagree_count: number;
  disagree_percent: number; // 0-100
};

export default function StudiesTimeSeries() {
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [monthsLoading, setMonthsLoading] = useState(false);
  const [score, setScore] = useState<number>(4);
  const [rows, setRows] = useState<PointRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // no per-trainee lines: only overall averages

  // fetch months
  useEffect(() => {
    let mounted = true;
    setMonthsLoading(true);
    fetch('/api/rpr/residency/months', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then((payload) => {
        if (!mounted) return;
        if (payload && payload.success && Array.isArray(payload.data)) {
          const list = payload.data as string[];
          list.sort((a, b) => b.localeCompare(a));
          setMonths(list);
          if (list.length > 0) setSelectedMonth(list[0]);
        }
      })
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => { if (mounted) setMonthsLoading(false); });
    return () => { mounted = false; };
  }, []);

  // no per-trainee cohort fetch: we only display overall avg line

  // fetch series data when selectedMonth or score changes
  useEffect(() => {
    if (!selectedMonth) return;
    let mounted = true;
    setLoading(true);
    setError(null);
    fetch(`/api/rpr/residency?month=${selectedMonth}&score=${score}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then((payload) => {
        if (!mounted) return;
        if (payload && payload.success && payload.data) {
          setRows(payload.data as PointRow[]);
        } else {
          setError(payload?.message || 'Unexpected response');
        }
      })
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => { if (mounted) setLoading(false); });

    return () => { mounted = false; };
  }, [selectedMonth, score]);

  const labels = rows.map(r => r.label);
  const counts = rows.map(r => r.total_reports);
  const days = labels.length || 1;
  const totalReportsSum = counts.reduce((s, v) => s + (Number(v) || 0), 0);

  // overall averages
  const avgPerDay = +(totalReportsSum / days).toFixed(2);


  const palette = {
    backgroundColor: [
      'rgba(175, 213, 240, 0.6)',
      'rgba(178, 211, 194, 0.6)', 
      'rgba(255, 126, 112, 0.6)',
      'rgba(200, 206, 238, 0.6)',
      'rgba(255, 226, 108, 0.6)'
    ],
    borderColor: ['#afd5f0', '#b2d3c2', '#ff7e70', '#c8ceee', '#ffe26c']
  };

  const datasets: any[] = [];
  // Bar: restore blue bars
  datasets.push({
    type: 'bar' as const,
    label: 'Studies read',
    data: counts,
    backgroundColor: 'rgba(175,213,240,0.6)',
    borderColor: '#afd5f0',
    borderWidth: 1,
    yAxisID: 'y',
  });

  // overall average per day
  datasets.push({
    type: 'line' as const,
    label: 'Avg per day',
    data: labels.map(() => avgPerDay),
    borderColor: palette.borderColor[4] || '#ffe26c',
    backgroundColor: 'rgba(255,226,108,0.12)',
    borderDash: [4, 6],
    borderWidth: 2,
    pointRadius: 0,
    yAxisID: 'y',
  });

  // per-trainee lines removed per request

  const data = { labels, datasets };

  const options: any = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index' },
    scales: {
      x: { ticks: { maxRotation: 0, minRotation: 0 } },
      y: { title: { display: true, text: 'Studies read' }, beginAtZero: true },
    },
    plugins: {
      legend: { position: 'top' },
      tooltip: {
        callbacks: {
          title: (ctx: any) => ctx && ctx.length ? String(ctx[0].label || '') : '',
          label: (context: any) => {
            if (!context) return '';
            const dsLabel = context.dataset.label || '';
            if (context.dataset.type === 'bar') {
              return `${dsLabel}: ${context.parsed.y ?? context.raw}`;
            }
            return `${dsLabel}: ${Number(context.parsed.y ?? context.raw).toFixed(2)}`;
          }
        }
      }
    }
  };

  return (
    <div style={{ background: '#fff', padding: 12, borderRadius: 12, boxShadow: '0 6px 24px rgba(15,23,42,0.06)', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>Studies Read Over Time</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>Month</label>
          <select value={selectedMonth || ''} onChange={e => setSelectedMonth(e.target.value || null)} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #e6e6e6', fontSize: 13, color: '#374151', background: '#fff', height: 34 }}>
            {monthsLoading ? <option>Loading…</option> : (
              months.length === 0 ? <option value="">No data</option> : months.map(m => (
                <option key={m} value={m}>{m}</option>
              ))
            )}
          </select>

          <label style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginLeft: 8 }}>RPR</label>
          <select value={String(score)} onChange={e => setScore(Number(e.target.value))} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #e6e6e6', fontSize: 13, color: '#374151', background: '#fff', height: 34 }}>
            <option value={1}>RPR1</option>
            <option value={2}>RPR2</option>
            <option value={3}>RPR3</option>
            <option value={4}>RPR4</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 12, color: '#6b7280' }}>Loading…</div>
      ) : error ? (
        <div style={{ padding: 12, color: 'red' }}>{error}</div>
      ) : (
        // Match ResidencyAnalytics: subtract header height so chart canvas gets same pixel height
        <div style={{ height: 'calc(100% - 56px)', minHeight: 120 }}>
          <Chart type='bar' data={data as any} options={options} />
        </div>
      )}
    </div>
  );
}
