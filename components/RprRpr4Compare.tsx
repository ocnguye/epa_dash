"use client";

import React, { useEffect, useState } from 'react';

type Stats = {
  total_with_rpr: number;
  disagree_count: number;
  disagree_percent: number;
};

export default function RprRpr4Compare({ score = 4, setScore }: { score?: number | null; setScore?: (n: number | null) => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trainee, setTrainee] = useState<Stats | null>(null);
  const [overall, setOverall] = useState<Stats | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    const url = `/api/rpr/aggregate${typeof score === 'number' ? `?score=${score}` : ''}`;
    console.debug('[RprRpr4Compare] fetch', url, 'score:', score);
    fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then((payload) => {
        if (!mounted) return;
        if (payload && payload.success && payload.data) {
          setTrainee(payload.data.trainee || null);
          setOverall(payload.data.overall || null);
        } else {
          setError(payload?.message || 'Unexpected API response');
        }
      })
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => { if (mounted) setLoading(false); });

    return () => { mounted = false; };
  }, [score]);

  if (loading) return <div style={{ padding: 12, background: '#fff', borderRadius: 8 }}>Loading…</div>;
  if (error) return <div style={{ padding: 12, background: '#fff', borderRadius: 8, color: 'red' }}>{error}</div>;
  if (!trainee || !overall) return null;

  const barContainerStyle: React.CSSProperties = {
    background: '#f1f5f9',
    borderRadius: 8,
    height: 14,
    width: '100%',
    overflow: 'hidden'
  };

  const barFill = (percent: number, color: 'blue' | 'red' = 'blue') => {
    const pct = `${Math.max(0, Math.min(100, percent))}%`;
    const bg = color === 'blue'
      ? 'linear-gradient(90deg,#60a5fa,#3b82f6)'
      : 'linear-gradient(90deg,#fca5a5,#ef4444)';
    return ({
      height: '100%',
      width: pct,
      background: bg,
    } as React.CSSProperties);
  };

  return (
    <div style={{ padding: 12, background: '#fff', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.04)', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
  <div style={{ fontSize: 13, color: '#374151', fontWeight: 700 }}>{`RPR${score ?? ' All'} Rate`}</div>
        <div style={{ display: 'inline-block' }}>
          <label htmlFor="rpr-score-select-compare" style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginRight: 8 }}>RPR</label>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <select
              id="rpr-score-select-compare"
              value={String(score ?? 0)}
              onChange={(e) => {
                const v = Number(e.target.value);
                setScore && setScore(v === 0 ? null : v);
              }}
              style={{
                padding: '6px 34px 6px 10px',
                borderRadius: 8,
                border: '1px solid rgba(0, 0, 0, 0.3)',
                background: 'rgba(175,213,240,0.06)',
                fontWeight: 600,
                cursor: 'pointer',
                color: 'rgba(0, 0, 0, 0.6)',
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

      <div style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>
        Compare the percentage of your reports at the selected RPR level to the corresponding percentage across all residents.
            <ul style={{ fontSize: 13, color: '#374151', paddingLeft: 16 }}>
                <li><strong>RPR 1:</strong> Agree </li>
                <li><strong>RPR 2:</strong> Agree with Incidental Finding </li>
                <li><strong>RPR 3:</strong> Agree </li>
                <li><strong>RPR 4:</strong> Disagree with Preliminary Report </li>
            </ul>

      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 13, color: '#444' }}>You</div>
        <div style={{ fontSize: 13, color: '#111', fontWeight: 700 }}>{Number(trainee.disagree_percent).toFixed(2)}%</div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={barContainerStyle}>
          <div style={barFill(trainee.disagree_percent, 'blue')} />
        </div>
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6 }}>{`${trainee.disagree_count} Reports / ${trainee.total_with_rpr} Total Reports`}</div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 13, color: '#444' }}>All residents</div>
        <div style={{ fontSize: 13, color: '#111', fontWeight: 700 }}>{Number(overall.disagree_percent).toFixed(2)}%</div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={barContainerStyle}>
          <div style={barFill(overall.disagree_percent, 'red')} />
        </div>
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6 }}>{`${overall.disagree_count} Reports / ${overall.total_with_rpr} Total Reports`}</div>
      </div>
    </div>
  );
}
