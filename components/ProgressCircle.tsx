'use client'
import React, { useState } from 'react';

// Progress Circle Component
const ProgressCircle = ({ percentage, requestedCount, discussedCount, notRequiredCount, totalCount, size = 200, strokeWidth = 16, loading = false }: {
    // percentage is optional — otherwise computed as (discussedCount / requestedCount) * 100
    percentage?: number | null;
    requestedCount?: number | null;
    discussedCount?: number | null;
    notRequiredCount?: number | null;
    totalCount?: number | null;
    size?: number;
    strokeWidth?: number;
    loading?: boolean;
}) => {
    // determine the effective percentage to render:
    // Completed = discussed + not_required (these don't require further trainee action)
    // Percentage = (completed / totalCount) * 100. This means remaining percentage reflects currently requested feedback.
    const computedPercentage = (() => {
        if (typeof percentage === 'number' && Number.isFinite(percentage)) return Math.max(0, Math.min(100, percentage));
        const discussed = typeof discussedCount === 'number' && Number.isFinite(discussedCount) ? discussedCount : 0;
        const notReq = typeof notRequiredCount === 'number' && Number.isFinite(notRequiredCount) ? notRequiredCount : 0;
        const total = typeof totalCount === 'number' && Number.isFinite(totalCount) ? totalCount : 0;
        if (total === 0) return 0;
        const completed = discussed + notReq;
        return Math.max(0, Math.min(100, (completed / total) * 100));
    })();

    const displayRequested = typeof requestedCount === 'number' && Number.isFinite(requestedCount) ? requestedCount : 0;
    const displayDiscussed = typeof discussedCount === 'number' && Number.isFinite(discussedCount) ? discussedCount : 0;
    const displayNotRequired = typeof notRequiredCount === 'number' && Number.isFinite(notRequiredCount) ? notRequiredCount : 0;
    const displayTotal = typeof totalCount === 'number' && Number.isFinite(totalCount) ? totalCount : 0;

    const radius = (size - strokeWidth) / 2;
    const circumference = radius * 2 * Math.PI;
    const strokeDasharray = circumference;
    const strokeDashoffset = circumference - (computedPercentage / 100) * circumference;

    const tooltipText = loading ? 'Loading...' : `Total: ${displayTotal}\nRequested: ${displayRequested}\nDiscussed: ${displayDiscussed}\nNot required: ${displayNotRequired}`;
    const [hover, setHover] = useState(false);

    return (
        <div style={{ position: 'relative', width: size, height: size }}>
            <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
                {/* SVG native title for better cross-browser hover behavior */}
                <title>{tooltipText}</title>
                {/* Background circle */}
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke="#e8f5e8"
                    strokeWidth={strokeWidth}
                    fill="#fff"
                />
                {/* Progress circle */}
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke="#b2d3c2"
                    strokeWidth={strokeWidth}
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={strokeDasharray}
                    strokeDashoffset={loading ? circumference : strokeDashoffset}
                    style={{
                        transition: 'stroke-dashoffset 1.5s ease-in-out',
                    }}
                />
            </svg>
            {/* Center text - make wrapper non-interactive so hover can target the percentage specifically */}
            <div
                style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    textAlign: 'center',
                    pointerEvents: 'none',
                }}
            >
                <div
                    // show a custom tooltip on hover (native title was inconsistent across layers)
                    aria-label={tooltipText}
                    onMouseEnter={() => setHover(true)}
                    onMouseLeave={() => setHover(false)}
                    style={{ fontSize: 42, color: '#b2d3c2', fontWeight: 700, pointerEvents: 'auto' }}
                >
                    {loading ? '...' : (displayTotal > 0 ? `${Math.round(computedPercentage)}%` : '0%')}
                </div>
                {/* Custom tooltip box (multiline) */}
                {hover && !loading && (
                    <div role="tooltip" style={{
                        position: 'absolute',
                        left: '50%',
                        top: 8,
                        transform: 'translateX(-50%)',
                        background: 'rgba(0, 0, 0, 0.8)',
                        border: '1px solid #4a90e2',
                        padding: '8px 10px',
                        borderRadius: 6,
                        // subtle shadow similar to chart tooltips
                        boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
                        whiteSpace: 'pre-line',
                        fontSize: 12,
                        color: '#fff',
                        zIndex: 50,
                        pointerEvents: 'none',
                        // wider so each metric sits on its own line without wrapping
                        minWidth: 140,
                        maxWidth: 220,
                        textAlign: 'left',
                        lineHeight: 1.4,
                    }}>{tooltipText}</div>
                )}
                <div style={{ fontSize: 12, color: '#000', marginTop: 6, fontWeight: 600, lineHeight: 1.2, pointerEvents: 'none' }}>
                    {loading ? 'Loading' : 'SEEK FEEDBACK RATE'}
                </div>
            </div>
        </div>
    );
};

export default ProgressCircle;
