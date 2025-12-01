"use client";

import React, { useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { Bar } from 'react-chartjs-2';

type Trainee = {
    user_id: number;
    preferred_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    pgy?: number | null;
    avg_epa?: number | null;
    report_count?: number;
};

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

export default function AdminCohortChart({ trainees }: { trainees: Trainee[] }) {
    const cohortChart = useMemo(() => {
        const list = trainees.slice();
        const labels = list.map(t => {
            const preferred = t.preferred_name && String(t.preferred_name).trim() ? String(t.preferred_name).trim() : undefined;
            const first = t.first_name && String(t.first_name).trim() ? String(t.first_name).trim() : '';
            const last = t.last_name && String(t.last_name).trim() ? String(t.last_name).trim() : '';
            const given = preferred ?? first;
            return `${given}${last ? ' ' + last : ''}`.trim();
        });
        const data = list.map(t => {
            const n = Number(t.avg_epa);
            return Number.isFinite(n) ? n : 0;
        });

        const count = labels.length;
        const categoryPercentage = count <= 5 ? 0.9 : count <= 10 ? 0.8 : 0.7;
        const barPercentage = count <= 5 ? 1.0 : 0.9;
        const maxBarThickness = count <= 5 ? 72 : undefined;

        return {
            labels,
            datasets: [
                {
                    label: 'Average EPA',
                    data,
                    backgroundColor: labels.map(() => 'rgba(175,213,240,0.6)'),
                    borderColor: labels.map(() => '#afd5f0'),
                    borderWidth: 2,
                    borderRadius: 0,
                    categoryPercentage,
                    barPercentage,
                    maxBarThickness,
                    pgy: list.map(t => t.pgy ?? ''),
                    reports: list.map(t => t.report_count ?? 0),
                } as any
            ]
        };
    }, [trainees]);

    const cohortOptions = useMemo(() => {
        const count = (trainees || []).length;
        // We'll size the chart by container height instead of aspectRatio so it can be larger when needed.
        return {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                title: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: '#4a90e2',
                    borderWidth: 1,
                    callbacks: {
                        label: function(context: any) {
                            try {
                                const idx = context.dataIndex;
                                const ds = context.dataset as any;
                                const avg = context.parsed?.y ?? context.parsed ?? context.raw ?? '';
                                const lines: string[] = [];
                                if (typeof avg === 'number' && !Number.isNaN(avg)) lines.push(`Average EPA: ${avg.toFixed(2)}`);
                                else lines.push(`Average EPA: ${String(avg)}`);
                                if (Array.isArray(ds.pgy)) lines.push(`PGY: ${ds.pgy[idx]}`);
                                if (Array.isArray(ds.reports)) lines.push(`Reports: ${ds.reports[idx]}`);
                                return lines;
                            } catch (e) {
                                return '';
                            }
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    min: 1,
                    max: 5,
                    ticks: { stepSize: 1 },
                    grid: { color: 'rgba(0,0,0,0.06)' },
                    title: { display: true, text: 'Average EPA' }
                },
                x: {
                    grid: { color: 'rgba(0,0,0,0.03)' },
                    ticks: { maxRotation: 45, minRotation: 0 }
                }
            }
        };
    }, [trainees]);

    if (!cohortChart.labels || cohortChart.labels.length === 0) {
        return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 180, color: '#6b7280' }}>No data to display</div>;
    }

    // Compute a reasonable height for the chart container. Use a smaller default and gentler growth
    // so the chart isn't excessively tall when stacked in the layout.
    const count = cohortChart.labels.length || 0;
    const chartHeight = Math.max(200, Math.min(480, Math.round(count * 36)));

    return (
        <div style={{ width: '100%', height: chartHeight }}>
            <Bar data={cohortChart} options={cohortOptions as any} />
        </div>
    );
}
