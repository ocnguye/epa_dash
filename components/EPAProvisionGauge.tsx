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
    size?: number;       // diameter in px (default 180)
    stroke?: number;     // ring thickness (default 14)
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProvisionGauge({ rate, size = 360, stroke = 14 }: ProvisionGaugeProps) {
    const r = (size - stroke) / 2;
    const circ = 2 * Math.PI * r;
    const pct = rate ?? 0;
    const dash = (pct / 100) * circ;
    const color = rateColor(rate);
    const trackColor = rate === null ? '#f3f4f6'
        : rate >= 75 ? '#e8f5e8'
        : rate >= 50 ? 'rgba(255, 226, 108, 0.2)'
        : 'rgba(255, 126, 112, 0.15)';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0 }}>
            {/* Ring */}
            <div style={{ position: 'relative', width: size, height: size }}>
                <svg
                    width={size}
                    height={size}
                    style={{ transform: 'rotate(-90deg)', display: 'block' }}
                >
                    {/* White fill — radius extended to inner edge of the stroke */}
                    <circle
                        cx={size / 2} cy={size / 2} r={r + stroke / 2}
                        fill="#fff"
                        stroke="none"
                    />

                    {/* Track background */}
                    <circle
                        cx={size / 2} cy={size / 2} r={r}
                        stroke={trackColor}
                        strokeWidth={stroke}
                        fill="none"
                    />

                    {/* Progress */}
                    <circle
                        cx={size / 2} cy={size / 2} r={r}
                        fill="none"
                        stroke={color}
                        strokeWidth={stroke}
                        strokeDasharray={`${dash} ${circ - dash}`}
                        strokeLinecap="round"
                        style={{ transition: 'stroke-dasharray 0.7s ease, stroke 0.4s ease' }}
                    />
                </svg>

                {/* Center text */}
                <div style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 2,
                }}>
                    <span style={{ fontSize: size * 0.2, fontWeight: 700, color, lineHeight: 1 }}>
                        {rate !== null ? `${rate}%` : '—'}
                    </span>

                    {/* Label inside ring */}
                    <div style={{
                        marginTop: 12,
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#000',
                        textTransform: 'uppercase',
                        textAlign: 'center',
                        letterSpacing: '0.04em',
                        lineHeight: 1.4,
                    }}>
                        Avg EPA Provision<br />Rate
                    </div>
                </div>
            </div>


        </div>
    );
}