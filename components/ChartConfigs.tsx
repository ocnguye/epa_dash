import { ChartOptions } from 'chart.js';

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
                        const ds = context.dataset as any;
                        const val = (context.parsed && typeof context.parsed.y === 'number') ? context.parsed.y : (context.raw ?? null);
                        const lines: string[] = [];
                        if (typeof val === 'number' && !Number.isNaN(val)) {
                            lines.push(`${context.dataset.label}: ${val.toFixed(2)}`);
                        } else {
                            lines.push(`${context.dataset.label}: ${String(val)}`);
                        }
                        // Only show cohort average when hovering the cohort dataset itself
                        if (ds && ds.cohortValue && String(ds.label || '').toLowerCase().includes('cohort')) {
                            lines.push(`Cohort average (PGY): ${Number(ds.cohortValue).toFixed(2)}`);
                        }
                        return lines;
                    } catch (e) {
                        return `${context.dataset.label}: ${context.parsed?.y ?? 'N/A'}`;
                    }
                }
                ,
                footer: function(context: any) {
                    try {
                        if (!context || !context.length) return '';
                        const ds = context[0].dataset as any;
                        if (ds && String(ds.label || '').toLowerCase().includes('cohort')) {
                            const pgy = ds.cohortPgy ? `PGY ${ds.cohortPgy}` : 'PGY';
                            return `${pgy} cohort — All time`;
                        }
                        return '';
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

// Procedure-Specific EPA Bar Chart Options
export const procedureSpecificOptions: ChartOptions<'bar'> = {
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
                        const countLine = count !== null ? `Count: ${count}` : null;
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
                text: 'Procedure Codes'
            },
            ticks: {
                maxRotation: 45,
                minRotation: 0
            }
        }
    }
};
