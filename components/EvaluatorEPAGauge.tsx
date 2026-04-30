"use client";

import React, { useEffect, useRef } from 'react';

type EvaluatorEPAGaugeProps = {
    evaluator_avg_epa: number | null;
    evaluator_report_count: number;
    loading?: boolean;
};

export default function EvaluatorEPAGauge({ evaluator_avg_epa, evaluator_report_count, loading = false }: EvaluatorEPAGaugeProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const hasData = typeof evaluator_avg_epa === 'number' && evaluator_avg_epa > 0;
    const epa = hasData ? evaluator_avg_epa! : 0;

    const getColor = (val: number): string => {
        return '#afd5f0ff';
    };

    const arcColor = hasData ? getColor(epa) : '#e5e7eb';

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const SIZE = 300;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = SIZE * dpr;
        canvas.height = SIZE * dpr;
        canvas.style.width = `${SIZE}px`;
        canvas.style.height = `${SIZE}px`;
        ctx.scale(dpr, dpr);

        const cx = SIZE / 2;
        const cy = SIZE / 2;
        const radius = 120;
        const lw = 20;

        ctx.clearRect(0, 0, SIZE, SIZE);

        // White fill — covers everything inside the ring's inner edge
        ctx.beginPath();
        ctx.arc(cx, cy, radius + lw/2, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        // Grey track ring
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(175, 213, 240, 0.5)';
        ctx.lineWidth = lw;
        ctx.lineCap = 'butt';
        ctx.stroke();

        // Colored arc
        if (!loading && hasData) {
            const fraction = Math.min(epa / 5, 1);
            ctx.beginPath();
            ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + fraction * Math.PI * 2);
            ctx.strokeStyle = arcColor;
            ctx.lineWidth = lw;
            ctx.lineCap = 'round';
            ctx.stroke();
        }
    }, [epa, loading, hasData, arcColor]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div style={{ position: 'relative', width: 300, height: 300, flexShrink: 0 }}>
                <canvas ref={canvasRef} style={{ display: 'block' }} />
                <div style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, bottom: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none',
                }}>
                    {loading ? (
                        <span style={{ fontSize: 13, color: '#aaa' }}>...</span>
                    ) : (
                        <>
                            <span style={{ fontSize: 48, fontWeight: 700, color: arcColor, lineHeight: 1 }}>
                                {hasData ? epa.toFixed(2) : '—'}
                            </span>
                            <span style={{ fontSize: 14, color: '#888', marginTop: 6 }}>/ 5.00</span>
                        </>
                    )}
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Avg Evaluator EPA
                </span>
                <span style={{ fontSize: 12, color: '#888' }}>
                    {loading ? '—' : `${evaluator_report_count} report${evaluator_report_count !== 1 ? 's' : ''} evaluated`}
                </span>
            </div>
        </div>
    );
}