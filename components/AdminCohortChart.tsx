"use client";

import React, { useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend } from 'chart.js';
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

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend);

export default function AdminCohortChart({
    trainees,
    allTrainees,
    pgyFilter,
}: {
    trainees: Trainee[];           // already filtered by PGY (or full list if no filter)
    allTrainees: Trainee[];        // always the full unfiltered list, for overall avg
    pgyFilter?: number | null;
}) {

    // PGY Legend and Color Palette
        const PGY_COLORS = [
            'rgba(175, 213, 240, 0.6)', // PGY 1 — blue
            'rgba(178, 211, 194, 0.6)', // PGY 2 — green
            'rgba(255, 126, 112, 0.6)', // PGY 3 — coral
            'rgba(200, 206, 238, 0.6)', // PGY 4 — lavender
            'rgba(255, 226, 108, 0.6)', // PGY 5 — yellow
            'rgba(255, 196, 140, 0.6)', // PGY 6 — peach
            'rgba(200, 230, 180, 0.6)', // PGY 7 — sage
        ];
    
        const PGY_BORDERS = [
            '#afd5f0',
            '#b2d3c2',
            '#ff7e70',
            '#c8ceee',
            '#ffe26c',
            '#ffc48c',
            '#c8e6b4',
        ];

    // Compute reference line: cohort avg when PGY filter active, overall avg otherwise
    const { refValue, refLabel } = useMemo(() => {
        if (pgyFilter != null) {
            const vals = allTrainees
                .filter(t => t.pgy === pgyFilter) // applies avg calculation to pgy cohort
                .map(t => Number(t.avg_epa))
                .filter(v => Number.isFinite(v) && v > 0); // ignore zero/missing EPA
            const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
            return { refValue: avg, refLabel: `PGY-${pgyFilter} Cohort Avg` };
        }
        const vals = allTrainees
            .map(t => Number(t.avg_epa)) // applies avg calculation to entire trainee population
            .filter(v => Number.isFinite(v) && v > 0); // ignore zero/missing EPA
        const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
        return { refValue: avg, refLabel: 'Overall Avg EPA' };
    }, [allTrainees, pgyFilter]);

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

        const datasets: any[] = [
            {
                type: 'bar',
                label: 'Average EPA',
                data,
                backgroundColor: list.map(t => {
                    const pgy = t.pgy;
                    if (pgy != null && pgy >= 1 && pgy <= 7) return PGY_COLORS[pgy - 1];
                    return PGY_COLORS[0];
                }),
                borderColor: list.map(t => {
                    const pgy = t.pgy;
                    if (pgy != null && pgy >= 1 && pgy <= 7) return PGY_BORDERS[pgy - 1];
                    return PGY_BORDERS[0];
                }),
                borderWidth: 2,
                borderRadius: 0,
                categoryPercentage,
                barPercentage,
                maxBarThickness,
                pgy: list.map(t => t.pgy ?? ''),
                reports: list.map(t => t.report_count ?? 0),
                order: 2,
            }
        ];

        if (refValue !== null) {
            datasets.push({
                type: 'line',
                label: refLabel,
                data: labels.map(() => refValue),
                refValue,
                borderColor: '#ffe26c',
                backgroundColor: 'rgba(255, 226, 108, 0.12)',
                borderWidth: 2,
                borderDash: [6, 4],
                fill: false,
                tension: 0,
                pointRadius: 0,
                pointHoverRadius: 10,
                pointHitRadius: 10,
                order: 1,
            });
        }

        return { labels, datasets };
    }, [trainees, refValue, refLabel]);

    const cohortOptions = useMemo(() => ({
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                display: pgyFilter == null && cohortChart.datasets.length >= 1,
                position: 'top' as const,
                labels: {
                    usePointStyle: true,
                    generateLabels: (chart: any) => {
                        // Build one legend entry per PGY level present in the data
                        const pgySet = new Set<number>();
                        chart.data.datasets[0]?.pgy?.forEach((p: any) => {
                            if (p != null && p !== '') pgySet.add(Number(p));
                        });
                        const pgyEntries = Array.from(pgySet).sort((a, b) => a - b);

                        const pgyLabels = pgyEntries.map(pgy => ({
                            text: `PGY ${pgy}`,
                            fillStyle: PGY_COLORS[pgy - 1] ?? PGY_COLORS[0],
                            strokeStyle: PGY_BORDERS[pgy - 1] ?? PGY_BORDERS[0],
                            lineDash: [],
                            hidden: false,
                            pointStyle: 'rect' as const,
                            datasetIndex: 0,
                        }));

                        // Append the reference line entry if present
                        const lineDatasets = chart.data.datasets.filter((ds: any) => ds.type === 'line');
                        const lineLabels = lineDatasets.map((ds: any, i: number) => ({
                            text: ds.label,
                            fillStyle: ds.borderColor,
                            strokeStyle: ds.borderColor,
                            lineDash: ds.borderDash ?? [],
                            hidden: false,
                            pointStyle: 'line' as const,
                            datasetIndex: i + 1,
                        }));

                        return [...pgyLabels, ...lineLabels];
                    },
                },
            },
            title: { display: false },
            tooltip: {
                backgroundColor: 'rgba(0,0,0,0.8)',
                titleColor: '#fff',
                bodyColor: '#fff',
                borderColor: '#4a90e2',
                borderWidth: 1,
                callbacks: {
                    title: function(context: any) {
                        if (context?.length && context[0].dataset?.type === 'line') {
                            return [];
                        }
                        return context?.[0]?.label ? [String(context[0].label)] : [];
                    },
                    label: function(context: any) {
                        try {
                            const idx = context.dataIndex;
                            const ds = context.dataset as any;

                            if (ds.type === 'line') {
                                const val = typeof ds.refValue === 'number' ? ds.refValue.toFixed(2) : '';
                                return [`${ds.label}: ${val}`];
                            }

                            const lines: string[] = [];
                            const avg = context.parsed?.y ?? context.raw ?? '';
                            if (typeof avg === 'number' && !Number.isNaN(avg)) lines.push(`Average EPA: ${avg.toFixed(2)}`);
                            else lines.push(`Average EPA: ${String(avg)}`);
                            if (Array.isArray(ds.pgy)) lines.push(`PGY: ${ds.pgy[idx]}`);
                            if (Array.isArray(ds.reports)) lines.push(`Reports: ${ds.reports[idx]}`);
                            return lines;
                        } catch {
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
    }), [cohortChart.datasets.length]);

    if (!cohortChart.labels || cohortChart.labels.length === 0) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 180, color: '#6b7280' }}>
                No data to display
            </div>
        );
    }

    const count = cohortChart.labels.length;
    const chartHeight = Math.max(200, Math.min(480, Math.round(count * 36)));

    return (
        <div style={{ width: '100%', height: chartHeight }}>
            <Bar data={cohortChart as any} options={cohortOptions as any} />
        </div>
    );
}