'use client';

import React, { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { ChartOptions } from 'chart.js';

type Procedure = {
    report_id: number;
    create_date: string;
    proc_desc: string;
    seek_feedback: 'not_required' | 'feedback_requested' | 'discussed';
    complexity: number;
    oepa: number;
    trainee_name: string;
    attending_name: string;
    proc_code?: string;
};

type SeekFeedbackChartProps = {
    procedures: Procedure[];
    loading?: boolean;
    height?: number; 
};

const SeekFeedbackChart = ({ procedures, loading = false, height}: SeekFeedbackChartProps) => {
    const { chartData, weeklyStats } = useMemo(() => {
        if (!procedures.length) return { chartData: null, weeklyStats: [] };

        // Group procedures by week
        const weeklyData = procedures.reduce((acc, proc) => {
            const date = new Date(proc.create_date);
            const weekStart = new Date(date);
            weekStart.setDate(date.getDate() - date.getDay()); // Start of week (Sunday)
            const weekKey = weekStart.toISOString().split('T')[0];
            
            if (!acc[weekKey]) {
                acc[weekKey] = {
                    total: 0,
                    feedbackRequested: 0,
                    weekStart: weekStart
                };
            }
            
            acc[weekKey].total += 1;
            if (proc.seek_feedback === 'feedback_requested' || proc.seek_feedback === 'discussed') {
                acc[weekKey].feedbackRequested += 1;
            }
            
            return acc;
        }, {} as Record<string, { total: number; feedbackRequested: number; weekStart: Date }>);

        // Sort by date and calculate rates
        const sortedWeeks = Object.entries(weeklyData)
            .sort(([, a], [, b]) => a.weekStart.getTime() - b.weekStart.getTime())
            .map(([weekKey, data], index) => ({
                week: `Week ${index + 1}`,
                rate: (data.feedbackRequested / data.total) * 100,
                date: data.weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                feedbackRequested: data.feedbackRequested,
                total: data.total
            }));

        return {
            chartData: {
                labels: sortedWeeks.map(week => week.week),
                datasets: [
                {
                    label: 'Feedback Request Rate (%)',
                    data: sortedWeeks.map(week => week.rate),
                    borderColor: 'rgba(255, 226, 108, 0.8)',
                    backgroundColor: 'rgba(255, 204, 2, 0.2)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: 'rgba(255, 226, 108, 0.8)',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointRadius: 6,
                    pointHoverRadius: 8,
                }
                ]
            },
            weeklyStats: sortedWeeks
        };
    }, [procedures]);

    const chartOptions: ChartOptions<'line'> = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                display: false, // hide legend
            },
            tooltip: {
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                titleColor: '#fff',
                bodyColor: '#fff',
                borderColor: '#ffcc02',
                borderWidth: 1,
                callbacks: {
                    label: function(context) {
                        const weekData = weeklyStats[context.dataIndex];
                        return [
                            `Seek Feedback Rate: ${context.parsed.y.toFixed(1)}%`,
                            `Procedures with Feedback Requests: ${weekData.feedbackRequested}`,
                            `Total procedures: ${weekData.total}`
                        ];
                    }
                }
            }
        },
        scales: {
            y: {
                beginAtZero: true,
                max: 100,
                ticks: {
                    stepSize: 20,
                    callback: function(value) {
                        return value + '%';
                    }
                },
                grid: {
                    color: 'rgba(0, 0, 0, 0.1)',
                },
                title: {
                    display: true,
                    text: 'Feedback Request Rate (%)',
                    font: {
                        size: 12,
                        weight: 'bold'
                    }
                }
            },
            x: {
                grid: {
                    color: 'rgba(0, 0, 0, 0.1)',
                },
                title: {
                    display: true,
                    text: 'Time Period',
                    font: {
                        size: 12,
                        weight: 'bold'
                    }
                }
            }
        }
    };

    if (loading || !chartData) {
        return (
            <div style={{
                height: height,
                background: 'linear-gradient(90deg, #fff8e1 0%, #ffecb3 100%)',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#666',
                fontSize: 14,
                border: '2px dashed #ffcc02',
                textAlign: 'center',
                padding: 20,
            }}>
                {loading ? 'Loading feedback trends...' : 'No data available for feedback trends'}
            </div>
        );
    }

    return (
        <div style={{ height: height }}>
            <Line data={chartData} options={chartOptions} />
        </div>
    );
};

export default SeekFeedbackChart;