import { ChartOptions, ChartType } from 'chart.js';
declare module 'chart.js' {
    interface PluginOptionsByType<TType extends ChartType> {
        hoverSlopeLine?: boolean | Record<string, never>;
    }
}

// EPA Trend Chart Options
export const epaTrendOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    // Consistent animation settings across filter toggles to avoid unintended "wave" effects
    // when datasets or data points are added/removed. We disable tension animation so the
    // line shape does not morph in an animated "wave" when switching filters.
    // Slower, smoother animation for a more pleasant wave effect when filters toggle
    animation: {
        duration: 1000,
        easing: 'easeInOutCubic'
    },
    elements: {
        line: {
            // Prevent Chart.js from animating the tension property which can produce
            // a wave-like motion when the dataset updates. Keep tension animations off.
            tension: 0.4,
            // Per Chart.js v4, you can disable animation for line properties by
            // setting their animation duration to 0 under the `animations` map,
            // but elements.line.animation is widely supported to stop morphing.
            // Keep borderWidth stable here (datasets may override).
            borderWidth: 2 as any,
        },
    },
    // Fine-grained transition control: animate x/y and tension with scripted delays so the
    // wave always progresses left-to-right (staggered by data index). We avoid hard-coded
    // 'from'/'to' values which can cause animations to appear left-to-right or right-to-left
    // depending on whether datasets are added/removed or updated.
    transitions: {
        show: {
            animations: {
                x: {
                    duration: 1000,
                    easing: 'easeInOutCubic',
                    // stagger by data index to make the line draw left-to-right
                    delay: (ctx: any) => {
                        if (!(ctx.type === 'data' && typeof ctx.dataIndex === 'number')) return 0;
                        // reverse stagger so animation proceeds right-to-left
                        const ds = ctx.chart?.data?.datasets?.[ctx.datasetIndex];
                        const len = Array.isArray(ds?.data) ? ds.data.length : (ctx.chart?.data?.labels?.length || 0);
                        const max = Math.max(0, (len || 1) - 1);
                        return (max - ctx.dataIndex) * 25;
                    }
                },
                y: {
                    duration: 1000,
                    easing: 'easeInOutCubic',
                    delay: (ctx: any) => {
                        if (!(ctx.type === 'data' && typeof ctx.dataIndex === 'number')) return 0;
                        const ds = ctx.chart?.data?.datasets?.[ctx.datasetIndex];
                        const len = Array.isArray(ds?.data) ? ds.data.length : (ctx.chart?.data?.labels?.length || 0);
                        const max = Math.max(0, (len || 1) - 1);
                        return (max - ctx.dataIndex) * 25;
                    }
                },
                tension: {
                    duration: 1000,
                    easing: 'easeInOutCubic',
                    delay: (ctx: any) => (ctx.type === 'data' && typeof ctx.dataIndex === 'number') ? ctx.dataIndex * 25 : 0
                }
            }
        },
        hide: {
            animations: {
                x: {
                    duration: 600,
                    easing: 'easeInOutCubic',
                    // keep the same left-to-right stagger on hide so direction is consistent
                    delay: (ctx: any) => {
                        if (!(ctx.type === 'data' && typeof ctx.dataIndex === 'number')) return 0;
                        const ds = ctx.chart?.data?.datasets?.[ctx.datasetIndex];
                        const len = Array.isArray(ds?.data) ? ds.data.length : (ctx.chart?.data?.labels?.length || 0);
                        const max = Math.max(0, (len || 1) - 1);
                        return (max - ctx.dataIndex) * 15;
                    }
                },
                y: {
                    duration: 600,
                    easing: 'easeInOutCubic',
                    delay: (ctx: any) => {
                        if (!(ctx.type === 'data' && typeof ctx.dataIndex === 'number')) return 0;
                        const ds = ctx.chart?.data?.datasets?.[ctx.datasetIndex];
                        const len = Array.isArray(ds?.data) ? ds.data.length : (ctx.chart?.data?.labels?.length || 0);
                        const max = Math.max(0, (len || 1) - 1);
                        return (max - ctx.dataIndex) * 15;
                    }
                },
                tension: {
                    duration: 600,
                    easing: 'easeInOutCubic',
                    delay: (ctx: any) => (ctx.type === 'data' && typeof ctx.dataIndex === 'number') ? ctx.dataIndex * 15 : 0
                }
            }
        }
    },
    interaction: {
        // require intersection so tooltip shows only for the hovered dataset (prevents mixed tooltips)
        mode: 'nearest',
        intersect: true,
        axis: 'x'
    },
    plugins: {
        legend: {
            display: false,
        },
        tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleColor: '#fff',
            bodyColor: '#fff',
            borderColor: '#4a90e2',
            borderWidth: 1,
            mode: 'nearest',
            intersect: true,
            callbacks: {
                title: function(context: any) {
                    try {
                        if (!context || !context.length) return '';
                        const ds = context[0].dataset as any;
                        // If hovering the cohort dataset, hide the title (so date is not shown)
                        if (ds && String(ds.label || '').toLowerCase().includes('cohort')) {
                            return [];
                        }
                        const lbl = context[0].label ?? (context[0].parsed && context[0].parsed.x ? String(context[0].parsed.x) : '');
                        return lbl ? [String(lbl)] : [];
                    } catch (e) {
                        return '';
                    }
                },
                label: function(context: any) {
                    try {
                        const val = (context.parsed && typeof context.parsed.y === 'number') ? context.parsed.y : (context.raw ?? null);
                        const lines: string[] = [];
                        if (typeof val === 'number' && !Number.isNaN(val)) {
                            lines.push(`${context.dataset.label}: ${val.toFixed(2)}`);
                        } else {
                            lines.push(`${context.dataset.label}: ${String(val)}`);
                        }

                        // Show report count only for the EPA Score dataset when count > 1
                        const ds = context.dataset as any;
                        if (!String(ds.label ?? '').toLowerCase().includes('cohort')) {
                            const counts = ds.reportCounts as number[] | undefined;
                            const count = counts?.[context.dataIndex];
                            if (typeof count === 'number' && count > 1) {
                                lines.push(`Report Count: ${count}`);
                            }
                        }

                        return lines;
                    } catch (e) {
                        return `${context.dataset.label}: ${context.parsed?.y ?? 'N/A'}`;
                    }
                },
                footer: function() {
                    return '';
                }
            }
        }
    },
    scales: {
        y: {
            beginAtZero: false,
            min: 1,
            max: 5.5,
            ticks: {
                stepSize: 1,
            },
            grid: {
                color: 'rgba(0, 0, 0, 0.1)',
            },
            title: {
                display: true,
                text: 'EPA Score'
            }
        },
        x: {
            grid: {
                color: 'rgba(0, 0, 0, 0.1)',
            },
            title: {
                display: true,
                text: 'Procedure Date'
            }
        }
    }
};

// Complexity vs EPA Scatter Chart Options
export const complexityVsEpaOptions: ChartOptions<'scatter'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: {
            display: false,
        },
        tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleColor: '#fff',
            bodyColor: '#fff',
            callbacks: {
                title: function() {
                    return 'Procedure Details';
                },
                label: function(context) {
                    return [
                        `Complexity: ${context.parsed.x}`,
                        `EPA Score: ${context.parsed.y}`
                    ];
                }
            }
        }
    },
    scales: {
        x: {
            beginAtZero: false,
            min: 0,
            max: 5,
            ticks: {
                stepSize: 1,
            },
            title: {
                display: true,
                text: 'Complexity Level'
            }
        },
        y: {
            beginAtZero: false,
            min: 1,
            max: 5,
            ticks: {
                stepSize: 1,
            },
            title: {
                display: true,
                text: 'EPA Score'
            }
        }
    }
};

export const procedureSpecificOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        hoverSlopeLine: false,
        legend: {
            display: false,
        },
        tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleColor: '#fff',
            bodyColor: '#fff',
            callbacks: {
                title: function(context) {
                    try {
                        const idx = context[0].dataIndex;
                        const ds = context[0].dataset as any;
                        const desc = ds?.descriptions && ds.descriptions[idx] ? ds.descriptions[idx] : '';
                        return desc || `${context[0].label}`;
                    } catch (e) {
                        return context && context[0] ? String(context[0].label) : '';
                    }
                },
                label: function(context) {
                    try {
                        const ds = context.dataset as any;
                        const idx = context.dataIndex;
                        const avg = context.parsed && typeof context.parsed.y === 'number' ? context.parsed.y : NaN;
                        const avgLine = `Average EPA: ${isFinite(avg) ? avg.toFixed(1) : 'N/A'}`;
                        const count = ds?.counts && typeof ds.counts[idx] !== 'undefined' ? ds.counts[idx] : null;
                        const countLine = count !== null ? `Report Count: ${count}` : null;
                        return countLine ? [avgLine, countLine] : [avgLine];
                    } catch (e) {
                        return `Average EPA: ${context.parsed?.y ?? 'N/A'}`;
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
            ticks: {
                stepSize: 1,
            },
            title: {
                display: true,
                text: 'Average EPA Score'
            }
        },
        x: {
            title: {
                display: true,
                text: 'Procedure Description'
            },
            ticks: {
                maxRotation: 45,
                minRotation: 45,
                autoSkip: false,
            }
        }
    }
};

// HOVER SLOPE PLUGIN for EPA Trend: comment this entire block out to disable
export const hoverSlopePlugin = {
    id: 'hoverSlopeLine',

    _drawSlopeLabel(chart: any) {
        if (!chart.options.plugins?.hoverSlopeLine) return;
        if (!chart.scales?.y || !chart.scales?.x) return;

        const datasets = chart.data.datasets || [];
        const dataset = datasets.find(
            (ds: any) => !String(ds.label ?? '').toLowerCase().includes('cohort')
        ) ?? datasets[0];

        if (!dataset) return;

        const points: Array<{ v: number; i: number; t?: number }> = (dataset.data || [])
            .map((v: any, i: number): { v: number; i: number; t?: number } => {
                let t: number | undefined;

                const dsTimestamps = (dataset as any).timestamps as Array<number | string> | undefined;
                if (dsTimestamps && typeof dsTimestamps[i] !== 'undefined') {
                    const maybe = dsTimestamps[i];
                    const parsed = typeof maybe === 'number'
                        ? maybe
                        : Date.parse(String(maybe).replace('Z', '').replace(/T.*$/, '') + 'T00:00:00');
                    if (!Number.isNaN(parsed)) t = parsed;
                }

                if (typeof t === 'undefined' && v && typeof v === 'object' && (v as any).x) {
                    const parsed = Date.parse(String((v as any).x).replace('Z', '').replace(/T.*$/, '') + 'T00:00:00');
                    if (!Number.isNaN(parsed)) t = parsed;
                }

                return {
                    v:
                        v != null && typeof v === 'object' && typeof (v as any).y === 'number'
                            ? (v as any).y
                            : v == null
                            ? null
                            : Number(v),
                    i,
                    t,
                };
            })
            .filter((p: { v: number; i: number; t?: number }) => p.v !== null && Number.isFinite(p.v));

        if (points.length < 2) return;

        const pointsWithTime = points.filter(p => typeof p.t === 'number');

        let slopeLabel = '';
        let slopeColor = '#16a34a';

        const n = pointsWithTime.length;
        if (n >= 2) {
            const meanT = pointsWithTime.reduce((s, p) => s + p.t!, 0) / n;
            const meanV = pointsWithTime.reduce((s, p) => s + p.v, 0) / n;
            const num = pointsWithTime.reduce((s, p) => s + (p.t! - meanT) * (p.v - meanV), 0);
            const den = pointsWithTime.reduce((s, p) => s + (p.t! - meanT) ** 2, 0);

            if (den !== 0) {
                const slopePerMs = num / den;
                const slopePerDay = slopePerMs * (1000 * 60 * 60 * 24);
                const slopePerMonth = slopePerDay * 30;
                slopeColor = slopePerDay >= 0 ? '#16a34a' : '#dc2626';
                slopeLabel = `Trend: ${slopePerMonth >= 0 ? '+' : ''}${slopePerMonth.toFixed(2)} EPA/month (${slopePerDay >= 0 ? '+' : ''}${slopePerDay.toFixed(3)} EPA/day)`;
            }
        }

        if (!slopeLabel && points.length >= 2) {
            const first = points[0];
            const last = points[points.length - 1];
            const idxDiff = last.i - first.i;
            const deltaY = last.v - first.v;
            slopeColor = deltaY >= 0 ? '#16a34a' : '#dc2626';
            if (idxDiff !== 0) {
                const slopePerProc = deltaY / idxDiff;
                slopeLabel = `Trend: ${slopePerProc >= 0 ? '+' : ''}${slopePerProc.toFixed(3)} EPA/procedure`;
            } else {
                slopeLabel = `Trend: ${deltaY >= 0 ? '+' : ''}${deltaY.toFixed(3)} EPA`;
            }
        }

        if (!slopeLabel) return;

        const topY = chart.scales.y.top;
        const leftX = chart.scales.x.left;
        if (!Number.isFinite(topY) || !Number.isFinite(leftX)) return;

        const ctx = chart.ctx;
        ctx.save();
        ctx.font = '600 12px Ubuntu, sans-serif';
        ctx.fillStyle = slopeColor;
        ctx.textAlign = 'left';
        ctx.fillText(slopeLabel, leftX + 8, topY + 16);
        ctx.restore();
    },

    afterRender(chart: any) {
        this._drawSlopeLabel(chart);
    },

    afterDraw(chart: any) {
        this._drawSlopeLabel(chart);

        // Vertical hover line — only when a point is active
        if (!chart.options.plugins?.hoverSlopeLine) return;
        if (!chart.scales?.y || !chart.scales?.x) return;
        if (!chart.tooltip?._active?.length) return;

        const activePoint = chart.tooltip._active[0];
        const x = activePoint.element.x;
        const topY = chart.scales.y.top;
        const bottomY = chart.scales.y.bottom;

        const ctx = chart.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x, topY);
        ctx.lineTo(x, bottomY);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.restore();
    },
};
// END HOVER SLOPE PLUGIN