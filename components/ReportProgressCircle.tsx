'use client';

import React, { useEffect, useRef } from 'react';

type Props = {
    completed: number;
    total?: number;
    loading?: boolean;
};

export default function ReportProgressCircle({
    completed,
    total = 1000,
    loading = false
}: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const hasData = typeof completed === 'number' && completed >= 0;
    const value = hasData ? completed : 0;

    const getColor = (val: number) => {
        if (val >= 750) {
            return {
                fill: 'rgba(175, 213, 240, 0.6)',
                border: '#afd5f0',
                track: 'rgba(175, 213, 240, 0.25)',
            };
        }

        if (val >= 500) {
            return {
                fill: 'rgba(178, 211, 194, 0.6)',
                border: '#b2d3c2',
                track: 'rgba(178, 211, 194, 0.25)',
            };
        }

        if (val >= 250) {
            return {
                fill: 'rgba(255, 226, 108, 0.6)',
                border: '#ffe26c',
                track: 'rgba(255, 226, 108, 0.25)',
            };
        }

        return {
            fill: 'rgba(255, 126, 112, 0.6)',
            border: '#ff7e70',
            track: 'rgba(255, 126, 112, 0.25)',
        };
    };

    const color = hasData ? getColor(value) : null;
    const arcColor = color?.border ?? '#e5e7eb';
    const trackColor = color?.track ?? 'rgba(229, 231, 235, 0.25)';

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

        // white center fill (Evaluator style)
        ctx.beginPath();
        ctx.arc(cx, cy, radius + lw / 2, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        // background track
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = color?.track ?? 'rgba(175, 213, 240, 0.25)';        
        ctx.lineWidth = lw;
        ctx.lineCap = 'butt';
        ctx.stroke();

        // progress arc
        if (!loading && hasData && total > 0) {
            const fraction = Math.min(value / total, 1);

            ctx.beginPath();
            ctx.arc(
                cx,
                cy,
                radius,
                -Math.PI / 2,
                -Math.PI / 2 + fraction * Math.PI * 2
            );

            ctx.strokeStyle = arcColor;
            ctx.lineWidth = lw;
            ctx.lineCap = 'round';
            ctx.stroke();
        }
    }, [value, total, loading, hasData, arcColor]);

    const percentage = total > 0 ? (value / total) * 100 : 0;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            
            {/* Gauge */}
            <div style={{ position: 'relative', width: 300, height: 300, flexShrink: 0 }}>
                <canvas ref={canvasRef} style={{ display: 'block' }} />

                {/* Center overlay (Evaluator style) */}
                <div style={{
                    position: 'absolute',
                    inset: 0,
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
                            {/* Label moved INSIDE gauge */}
                            <span style={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: '#92400e',
                                textTransform: 'uppercase',
                                letterSpacing: '0.08em',
                                marginBottom: 8,
                                opacity: 0.85
                            }}>
                                Report Progress
                            </span>

                            {/* Main value */}
                            <span style={{
                                fontSize: 48,
                                fontWeight: 700,
                                color: arcColor,
                                lineHeight: 1
                            }}>
                                {hasData ? value : '—'}
                            </span>

                            {/* Sub value */}
                            <span style={{
                                fontSize: 14,
                                color: '#888',
                                marginTop: 6
                            }}>
                                / {total}
                            </span>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}