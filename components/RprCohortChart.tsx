"use client";

import React, { useEffect, useState } from 'react';
import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  CategoryScale,
} from 'chart.js';
import { Scatter } from 'react-chartjs-2';

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend, CategoryScale);

type TraineePoint = {
  anon_id: string; // e.g., 'Trainee 1'
  is_current: boolean;
  pgy: number | null;
  disagree_percent: number; // 0-100
  disagree_count: number;
  total_with_rpr: number;
};

export default function RprCohortChart({ score = 4 }: { score?: number }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState<TraineePoint[]>([]);
  const [cohortPercent, setCohortPercent] = useState<number>(0);
  const [overallPercent, setOverallPercent] = useState<number>(0);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetch(`/api/rpr/cohort${(typeof score === 'number' && score > 0) ? `?score=${score}` : ''}`)
      .then(r => r.json())
      .then((payload) => {
        if (!mounted) return;
        if (payload && payload.success && payload.data) {
          const raw: any = payload.data;
          const trainees = (raw.trainees || []).map((t: any, idx: number) => ({
            anon_id: `Trainee ${idx + 1}`,
            is_current: !!t.is_current,
            pgy: t.pgy ?? null,
            disagree_percent: Number(t.disagree_percent) || 0,
            disagree_count: Number(t.disagree_count) || 0,
            total_with_rpr: Number(t.total_with_rpr) || 0,
          } as TraineePoint));
          setPoints(trainees);
          setCohortPercent(Number(raw.cohort_percent) || 0);
          setOverallPercent(Number(raw.overall_percent) || 0);
        } else {
          setError(payload?.message || 'Unexpected response');
        }
      })
      .catch(e => setError(String(e?.message || e)))
      .finally(() => { if (mounted) setLoading(false); });

    return () => { mounted = false; };
  }, [score]);

  if (loading) return <div style={{ padding: 12, background: '#fff', borderRadius: 8 }}>Loading chart…</div>;
  if (error) return <div style={{ padding: 12, background: '#fff', borderRadius: 8, color: 'red' }}>{error}</div>;
  if (!points.length) return <div style={{ padding: 12, background: '#fff', borderRadius: 8 }}>No trainee RPR data available.</div>;

  const dataPoints = points.map((p, i) => ({ x: i + 1, y: p.disagree_percent, meta: p }));
  const youPoint = points.findIndex(p => p.is_current) + 1; // index+1 or 0 if not found

  const datasets: any[] = [
    {
      label: 'Trainee',
      data: dataPoints.filter((d: any) => !(d.meta && d.meta.is_current)),
      // Use EPA dashboard palette (varied colors per point)
      backgroundColor: [
        'rgba(255, 126, 112, 0.6)',
      ],
      borderColor: [
        '#ff7e70',
      ],
      pointRadius: 6,
      hoverRadius: 6,
    },
  ];

  // add current user as separate dataset to highlight
  const current = points.find(p => p.is_current);
  if (current) {
    datasets.push({
      label: 'You',
      data: [{ x: youPoint, y: current.disagree_percent, meta: current }],
      // keep same size but different color and subtle border to highlight
      // Use EPA stronger blue for the current user
      backgroundColor: 'rgba(175, 213, 240, 0.6)',
      pointRadius: 6,
      hoverRadius: 6,
      borderColor: '#afd5f0',
      borderWidth: 1,
    });
  }

  // lines as flat line datasets across x-axis
  const maxX = points.length + 1;
  datasets.push({
    label: `Current Residency Average`,
    type: 'line',
    data: [{ x: 0, y: cohortPercent }, { x: maxX, y: cohortPercent }],
    // Use EPA cohort accent (yellow) from dashboard palette
    borderColor: 'rgba(255,226,108,0.95)',
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 6,
    pointHitRadius: 10,
    borderDash: [6, 4],
    fill: false,
  });

  datasets.push({
    label: `Historical Average`,
    type: 'line',
    data: [{ x: 0, y: overallPercent }, { x: maxX, y: overallPercent }],
    // Use a soft lavender/purple from the EPA palette
    borderColor: 'rgba(200,206,238,0.95)',
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 6,
    pointHitRadius: 10,
    borderDash: [4, 6],
    fill: false,
  });

  const data = { datasets };
  // compute adaptive y-axis range so small differences are visible
  const percents = points.map(p => Number(p.disagree_percent));
  let minPercent = percents.length ? Math.min(...percents) : 0;
  let maxPercent = percents.length ? Math.max(...percents) : 100;
  // compute padding as a fraction of the range, with a small minimum
  const span = Math.max(0.0001, maxPercent - minPercent);
  const pad = Math.max(0.5, span * 0.08); // at least 0.5 percentage points or 8% of span
  if (Math.abs(maxPercent - minPercent) < 0.0001) {
    // single-value dataset -> give a small neighborhood so points and lines are visible
    minPercent = Math.max(0, minPercent - 1);
    maxPercent = Math.min(100, maxPercent + 1);
  } else {
    minPercent = Math.max(0, +(minPercent - pad).toFixed(2));
    maxPercent = Math.min(100, +(maxPercent + pad).toFixed(2));
  }

  const options: any = {
    interaction: { mode: 'nearest', intersect: false },
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        type: 'linear',
        position: 'bottom',
        title: { display: true, text: 'Trainees (Anonymized)' },
        ticks: { display: false },
        grid: { display: false },
        min: 0,
        max: maxX,
      },
      y: {
        min: minPercent,
        max: maxPercent,
        title: { display: true, text: `RPR${score} %` },
        ticks: {
          // show up to 2 decimal places on axis ticks
          callback: (v: any) => `${Number(v).toFixed(2)}%`
        }
      },
    },
    plugins: {
      legend: { position: 'top' },
      tooltip: {
        callbacks: {
          title: (ctx: any) => {
            if (!ctx || !ctx.length) return '';
            const ds = ctx[0].dataset as any;
            // Show title for line datasets (averages) so users see which average they're hovering
            if (ds && (ds.type === 'line' || String(ds.label || '').toLowerCase().includes('avg'))) return ds.label || '';
            // Otherwise hide title for individual trainee points
            return '';
          },
          label: (context: any) => {
            const d = context.raw && context.raw.meta ? context.raw.meta : context.raw;
            if (d && d.meta) {
              const meta = d.meta as TraineePoint;
              const pct = Number(meta.disagree_percent).toFixed(2);
              if (meta.is_current) return `You — ${pct}% (${meta.disagree_count}/${meta.total_with_rpr})`;
              return `${meta.anon_id} — ${pct}% (${meta.disagree_count}/${meta.total_with_rpr})`;
            }
            // For line/average datasets, show the percentage value
            if (context && context.parsed && typeof context.parsed.y === 'number') {
              return `${context.dataset.label}: ${Number(context.parsed.y).toFixed(2)}%`;
            }
            return `${context.dataset.label}: N/A`;
          },
        },
      },
    },
  };

  return (
    <div style={{ background: '#fff', borderRadius: 8, padding: 12, height: '100%', boxShadow: '0 1px 6px rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 8 }}>{`Anonymized Cohort RPR${score} Comparison`}</div>
      <div style={{ flex: '1 1 0%', minHeight: 0 }}>
        <Scatter data={data as any} options={options} />
      </div>
    </div>
  );
}
