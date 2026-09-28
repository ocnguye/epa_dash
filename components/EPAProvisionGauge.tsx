'use client';

import React from 'react';

// ─── Color helpers (mirrors admindash palette) ────────────────────────────────

function rateColor(rate: number | null): string {
    if (rate === null) return '#9ca3af';
    if (rate >= 80) return '#b2d3c2';   // green border
    if (rate >= 50) return '#ffe26c';   // yellow border
    return '#ff7e70';                   // red border
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ProvisionGaugeProps {
    rate: number | null;
    size?: number;        // max diameter in px (default 360) — the ring scales DOWN to fit its container, never bigger than this
    stroke?: number;      // ring thickness, in the same units as `size` (default 14)
    className?: string;   // optional — lets a parent further clamp max-width via CSS (e.g. on mobile)
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProvisionGauge({ rate, size = 360, stroke = 14, className }: ProvisionGaugeProps) {
    const r = (size - stroke) / 2;
    const circ = 2 * Math.PI * r;
    const pct = rate ?? 0;
    const dash = (pct / 100) * circ;
    const color = rateColor(rate);
    const trackColor = rate === null ? '#f3f4f6'
        : rate >= 75 ? '#e8f5e8'
        : rate >= 50 ? 'rgba(255, 226, 108, 0.2)'
        : 'rgba(255, 126, 112, 0.15)';

    const cx = size / 2;
    const cy = size / 2;

    return (
        <div
            className={className}
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                width: '100%',
                maxWidth: size,
                aspectRatio: '1 / 1',
                margin: '0 auto',
            }}
        >
            {/* Ring — viewBox-based so it scales fluidly with its container instead of rendering at a fixed pixel size */}
            <svg
                viewBox={`0 0 ${size} ${size}`}
                width="100%"
                height="100%"
                style={{ display: 'block' }}
            >
                {/* Rotated group: white fill + track + progress arc */}
                <g style={{ transform: 'rotate(-90deg)', transformOrigin: `${cx}px ${cy}px` }}>
                    {/* White fill — radius extended to inner edge of the stroke */}
                    <circle
                        cx={cx} cy={cy} r={r + stroke / 2}
                        fill="#fff"
                        stroke="none"
                    />

                    {/* Track background */}
                    <circle
                        cx={cx} cy={cy} r={r}
                        stroke={trackColor}
                        strokeWidth={stroke}
                        fill="none"
                    />

                    {/* Progress */}
                    <circle
                        cx={cx} cy={cy} r={r}
                        fill="none"
                        stroke={color}
                        strokeWidth={stroke}
                        strokeDasharray={`${dash} ${circ - dash}`}
                        strokeLinecap="round"
                        style={{ transition: 'stroke-dasharray 0.7s ease, stroke 0.4s ease' }}
                    />
                </g>

                {/* Center text — lives inside the SVG so it scales proportionally with the ring at any rendered size, no separate font-size logic needed */}
                <text
                    x={cx}
                    y={cy - size * 0.02}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={size * 0.2}
                    fontWeight={700}
                    fill={color}
                >
                    {rate !== null ? `${rate}%` : '—'}
                </text>

                <text
                    x={cx}
                    y={cy + size * 0.14}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={size * 0.033}
                    fontWeight={600}
                    fill="#000"
                    style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}
                >
                    <tspan x={cx} dy="0">Avg EPA Provision</tspan>
                    <tspan x={cx} dy={size * 0.045}>Rate</tspan>
                </text>
            </svg>
        </div>
    );
}