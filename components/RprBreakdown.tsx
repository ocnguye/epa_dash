"use client";

import React, { useEffect, useState } from "react";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import { Pie } from "react-chartjs-2";

ChartJS.register(ArcElement, Tooltip, Legend);

type Row = {
  group: string;
  total_with_rpr: number;
  disagree_count: number;
  disagree_percent: number;
};

export default function RprBreakdown({
  score: externalScore,
}: {
  score?: number | null;
} = {}) {
  const [score, setScore] = useState<number | null>(
    typeof externalScore === "undefined" ? null : externalScore
  );
  const [groupBy, setGroupBy] = useState<
    "procedure_name" | "modality" | "patient_class"
  >("procedure_name");

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Prefer the parent's externalScore when supplied (synchronous), otherwise use local score state.
    const effectiveScore = typeof externalScore !== 'undefined' ? (externalScore ?? null) : score;

    // Keep visible local state in sync when parent controls value
    if (typeof externalScore !== 'undefined') setScore(externalScore ?? null);

    let mounted = true;
    setLoading(true);
    setError(null);

  const q: string[] = [];
  if (effectiveScore !== null) q.push(`score=${effectiveScore}`);
  if (groupBy) q.push(`groupBy=${groupBy}`);

    const url = `/api/rpr/breakdown${q.length ? '?' + q.join('&') : ''}`;

    fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then((r) => r.json())
      .then((payload) => {
        if (!mounted) return;
        if (payload && payload.success && payload.data) {
          setRows(payload.data.groups || []);
        } else {
          setError(payload?.message || "Unexpected response");
        }
      })
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [score, groupBy, externalScore]);

  const backgroundColor = [
    "rgba(175, 213, 240, 0.6)",
    "rgba(178, 211, 194, 0.6)",
    "rgba(255, 126, 112, 0.6)",
    "rgba(200, 206, 238, 0.6)",
    "rgba(255, 226, 108, 0.6)",
  ];
  const borderColor = [
    "#afd5f0",
    "#b2d3c2",
    "#ff7e70",
    "#c8ceee",
    "#ffe26c",
  ];

  const values = rows.map((r) => r.disagree_count || r.total_with_rpr);
  const labels = rows.map((r) => r.group);

  const totalSum = values.reduce((s, v) => s + (Number(v) || 0), 0);

  const data = {
    labels,
    datasets: [
      {
        label: "Count",
        data: values,
        backgroundColor: labels.map(
          (_, i) => backgroundColor[i % backgroundColor.length]
        ),
        borderColor: labels.map(
          (_, i) => borderColor[i % borderColor.length]
        ),
        borderWidth: 1,
      },
    ],
  };

  const options: any = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: any) => {
            const idx = ctx.dataIndex;
            const label = ctx.label || "";
            const val = ctx.dataset.data[idx] || 0;
            const pct =
              totalSum > 0
                ? ((Number(val) / totalSum) * 100).toFixed(2)
                : "0.00";
            return `${label}: ${val} (${pct}%)`;
          },
        },
      },
    },
    cutout: "60%",
  };

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 12,
        padding: 12,
        boxShadow: "0 1px 6px rgba(0,0,0,0.04)",
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: '100%',
      }}
    >
      {/* Header + Controls */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 800, color: "#111827" }}>
          RPR Breakdown
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          {/* GroupBy */}
          <div>
            <label
              htmlFor="groupby"
              style={{
                fontSize: 12,
                fontWeight: 700,
                marginRight: 8,
                color: "#374151",
              }}
            >
              Group
            </label>
            <select
              id="groupby"
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as any)}
              style={{
                padding: "6px 34px 6px 10px",
                borderRadius: 8,
                border: "1px solid rgba(0,0,0,0.12)",
                background: "rgba(175,213,240,0.06)",
                fontWeight: 700,
                fontSize: 13,
                color: '#374151',
                cursor: 'pointer'
              }}
            >
              <option value="procedure_name">ProcedureName</option>
              <option value="modality">Modality</option>
              <option value="patient_class">PatientClass</option>
            </select>
          </div>

          {/* Score */}
          <div>
            <label
              htmlFor="score"
              style={{
                fontSize: 12,
                fontWeight: 700,
                marginRight: 8,
                color: "#374151",
              }}
            >
              RPR
            </label>
            <select
              id="score"
              value={score === null ? "0" : String(score)}
              onChange={(e) => {
                const val = Number(e.target.value);
                setScore(val === 0 ? null : val);
              }}
              style={{
                padding: "6px 34px 6px 10px",
                borderRadius: 8,
                border: "1px solid rgba(0,0,0,0.12)",
                background: "rgba(175,213,240,0.06)",
                fontWeight: 700,
                fontSize: 13,
                color: '#374151',
                cursor: 'pointer'
              }}
            >
              <option value="0">All</option>
              <option value="1">RPR1</option>
              <option value="2">RPR2</option>
              <option value="3">RPR3</option>
              <option value="4">RPR4</option>
            </select>
          </div>

          {/* no sort control - sorting is server-side fixed to count desc */}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ padding: 12, color: '#6b7280' }}>Loading…</div>
      ) : error ? (
        <div style={{ padding: 12, color: 'red' }}>{error}</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 12, color: '#6b7280' }}>No data</div>
      ) : (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', width: '100%', flex: 1, minHeight: 0 }}>
          {/* Pie (fixed) - increased size so chart is more prominent */}
          <div style={{ flex: '0 0 360px', display: 'flex', alignItems: 'center', justifyContent: 'center', paddingRight: 8 }}>
            <div style={{ width: 340, height: 340 }}>
              <Pie data={data as any} options={options} />
            </div>
          </div>

          {/* List (shrink to remaining space) */}
          <div style={{ flex: 1, overflowY: 'auto', minWidth: 0, minHeight: 0, maxHeight: 520 }}>
            {rows.map((r, i) => {
              const val = Number(r.disagree_count || r.total_with_rpr || 0);
              const pct = totalSum > 0 ? (val / totalSum) * 100 : 0;

              return (
                <div key={r.group} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontSize: 14, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{r.group}</div>
                    <div style={{ textAlign: 'right', flex: '0 0 76px' }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#111827' }}>{val}</div>
                      <div style={{ fontSize: 12, color: '#374151' }}>{pct.toFixed(1)}%</div>
                    </div>
                  </div>

                  <div style={{ height: 10, background: '#f1f5f9', borderRadius: 6, overflow: 'hidden', marginTop: 8 }}>
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
