import { ChartOptions } from 'chart.js';

// EPA Trend Chart Options
export const epaTrendOptions: ChartOptions<'line'> = {
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
            borderColor: '#4a90e2',
            borderWidth: 1,
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
