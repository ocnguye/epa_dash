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

export default function ResidencyAnalytics() {
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null); // YYYY-MM
  const [months, setMonths] = useState<string[]>([]);
  const [rows, setRows] = useState<PointRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [score, setScore] = useState<number>(4);
  const [monthsLoading, setMonthsLoading] = useState(false);

  // fetch available months on mount
  useEffect(() => {
    let mounted = true;
    setMonthsLoading(true);
    fetch('/api/rpr/residency/months', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then((payload) => {
        if (!mounted) return;
        if (payload && payload.success && Array.isArray(payload.data)) {
          // payload.data expected like ['2022-06', '2022-07', ...]
          const list = payload.data as string[];
          // sort descending (most recent first)
          list.sort((a, b) => b.localeCompare(a));
                setMonths(list);
                if (list.length > 0) setSelectedMonth(list[0]);
        } else {
          setError(payload?.message || 'Unexpected response fetching months');
        }
      })
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => { if (mounted) setMonthsLoading(false); });

    return () => { mounted = false; };
  }, []);

  // fetch data when selectedMonth or score changes
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    const url = selectedMonth ? `/api/rpr/residency?month=${selectedMonth}&score=${score}` : `/api/rpr/residency?range=week&score=${score}`;

    fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
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
  const disagree = rows.map(r => +((r.disagree_percent || 0).toFixed(2)));

  const data = {
    labels,
    datasets: [
      {
        type: 'bar' as const,
        label: 'Reports read',
        data: counts,
        // Match the cohort chart blue used for the "You" point (so visuals are consistent)
        backgroundColor: 'rgba(175,213,240,0.9)',
        borderColor: '#afd5f0',
        borderWidth: 1,
        yAxisID: 'y',
      },
      {
        type: 'line' as const,
        label: 'Disagree %',
        data: disagree,
        borderColor: 'rgba(255,226,108,0.95)', // yellow
        backgroundColor: 'rgba(255,226,108,0.4)',
        yAxisID: 'y1',
        tension: 0.2,
        pointRadius: 4,
        borderWidth: 2,
      }
    ]
  };

  const options: any = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index' },
    scales: {
      x: { ticks: { maxRotation: 0, minRotation: 0 } },
      y: {
        position: 'left',
        title: { display: true, text: 'Reports' },
        beginAtZero: true,
      },
      y1: {
        position: 'right',
        title: { display: true, text: 'Disagree %' },
        beginAtZero: true,
        grid: { drawOnChartArea: false },
        ticks: {
          callback: (v: any) => `${v}%`
        }
      }
    },
    plugins: {
      legend: { position: 'top' },
      tooltip: {
        callbacks: {
          label: function(context: any) {
            const dsLabel = context.dataset.label || '';
            if (context.dataset.type === 'bar') {
              return `${dsLabel}: ${context.parsed.y ?? context.raw}`;
            }
            return `${dsLabel}: ${context.parsed.y ?? context.raw}%`;
          }
        }
      }
    }
  };

  return (
    <div style={{ background: '#fff', padding: 12, borderRadius: 12, boxShadow: '0 6px 24px rgba(15,23,42,0.06)', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>Residency-Wide Studies Read by Residents vs. Disagree Rate</div>
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
        // Reserve space for the header/controls (approx 56px) so chart canvases
        // across components get the same pixel height when parent column is fixed.
        <div style={{ height: 'calc(100% - 56px)', minHeight: 120 }}>
          <Chart type='bar' data={data as any} options={options} />
        </div>
      )}
    </div>
  );
}
