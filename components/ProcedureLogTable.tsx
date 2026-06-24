'use client';

import React from 'react';
import { computeAdjustedEPA } from '@/lib/adjustedEpa';

/* ─── Types ──────────────────────────────────────────────────────────────── */

export type Procedure = {
    report_id: number;
    create_date: string;
    proc_desc: string;
    proc_code?: string;
    seek_feedback: 'not_required' | 'feedback_requested' | 'discussed';
    complexity: number;
    oepa: number;
    trainee_name: string;
    attending_name: string;
    attending_user_ids: number[];
    fluoroscopy_time_minutes?: number | null;
    fluoroscopy_dose_value?: number | null;
};

export type AdjustedEpaMap = Record<
    number,
    ReturnType<typeof computeAdjustedEPA> | null
>;

interface ProcedureLogTableProps {
    procedures: Procedure[];
    adjustedEpaByReportId: AdjustedEpaMap;
    adjustedStatsLoading: boolean;
    loading: boolean;
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

const getEPADescription = (score: number) => {
    switch (score) {
        case 1: return '1 – Not allowed to practice procedure/task.';
        case 2: return '2 – Allowed to practice procedure/task only under proactive, full supervision.';
        case 3: return '3 – Allowed to practice procedure/task only under assisted direct supervision.';
        case 4: return '4 – Allowed to practice procedure/task without direct supervision.';
        case 5: return '5 – Allowed to supervise others in practice of procedure/task.';
        default: return 'Trainee was not observed by an attending in this capacity.';
    }
};

const getComplexityDescription = (complexity: number) => {
    switch (complexity) {
        case 1: return '1 – Straightforward';
        case 2: return '2 – Mildly Complex';
        case 3: return '3 – Moderately Complex';
        case 4: return '4 – Very Complex';
        case 5: return '5 – Extremely Complex';
        default: return 'Unavailable';
    }
};

/** Colour-coded complexity badge */
const ComplexityBadge = ({ value }: { value: number }) => {
    // Complexity 1 = easiest (green end), 5 = hardest (coral end)
    // Colours drawn from the shared PGY_BORDERS gradient palette.
    const colours: Record<number, { bg: string; text: string }> = {
        1: { bg: 'rgba(175, 213, 240, 0.30)', text: '#1e4976' },  // #afd5f0 — blue
        2: { bg: 'rgba(178, 211, 194, 0.30)', text: '#166534' },  // #b2d3c2 — green
        3: { bg: 'rgba(255, 226, 108, 0.30)', text: '#854d0e' },  // #ffe26c — yellow
        4: { bg: 'rgba(255, 196, 140, 0.30)', text: '#9a3412' },  // #ffc48c — peach
        5: { bg: 'rgba(255, 126, 112, 0.30)', text: '#7f1d1d' },  // #ff7e70 — coral
    };
    const c = colours[value] ?? { bg: '#f1f5f9', text: '#64748b' };
    return (
        <span
            title={getComplexityDescription(value)}
            style={{
                display: 'inline-block',
                padding: '2px 8px',
                borderRadius: 99,
                fontSize: 12,
                fontWeight: 600,
                background: c.bg,
                color: c.text,
                cursor: 'default',
            }}
        >
            {value ?? '—'}
        </span>
    );
};

/* ─── Component ──────────────────────────────────────────────────────────── */

export default function ProcedureLogTable({
    procedures,
    adjustedEpaByReportId,
    adjustedStatsLoading,
    loading,
}: ProcedureLogTableProps) {
    const thStyle: React.CSSProperties = {
        padding: '8px 12px',
        textAlign: 'left',
        color: '#495057',
        fontWeight: 600,
        borderBottom: '1px solid #dee2e6',
        whiteSpace: 'nowrap',
    };
    const thCenterStyle: React.CSSProperties = { ...thStyle, textAlign: 'center' };

    return (
        <table style={{ width: '100%', borderCollapse: 'collapse', color: '#0f172a', fontSize: 13 }}>
                <thead
                    style={{
                        position: 'sticky',
                        top: 0,
                        background: '#f8f9fa',
                        zIndex: 20,
                        boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
                    }}
                >
                    <tr>
                        <th style={thStyle}>Date</th>
                        <th style={thStyle}>
                            <strong>Trainee</strong>
                        </th>
                        <th style={thStyle}>Description</th>
                        <th style={thCenterStyle}>Complexity</th>
                        <th style={thCenterStyle}>EPA</th>
                        <th style={thCenterStyle}>Adj. EPA</th>
                    </tr>
                </thead>

                <tbody>
                    {loading ? (
                        <tr>
                            <td
                                colSpan={6}
                                style={{ textAlign: 'center', color: '#888', padding: '20px' }}
                            >
                                Loading...
                            </td>
                        </tr>
                    ) : procedures.length === 0 ? (
                        <tr>
                            <td
                                colSpan={6}
                                style={{ textAlign: 'center', color: '#9ca3af', padding: '20px' }}
                            >
                                No procedures recorded yet.
                            </td>
                        </tr>
                    ) : (
                        procedures.map((proc) => (
                            <tr
                                key={proc.report_id}
                                style={{ borderBottom: '1px solid #f8f9fa' }}
                            >
                                {/* Date */}
                                <td style={{ padding: '8px 12px', color: '#000', whiteSpace: 'nowrap' }}>
                                    {proc.create_date}
                                </td>

                                {/* Trainee / Attending */}
                                <td style={{ padding: '8px 12px', color: '#000' }}>
                                    <div style={{ fontWeight: 600 }}>{proc.trainee_name}</div>
                                    <div style={{ fontSize: 12, color: '#666' }}>
                                        {proc.attending_name}
                                    </div>
                                </td>

                                {/* Description */}
                                <td style={{ padding: '8px 12px', color: '#000' }}>
                                    {proc.proc_desc}
                                </td>

                                {/* Complexity */}
                                <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                    {proc.complexity && Number(proc.complexity) > 0 ? (
                                        <ComplexityBadge value={Number(proc.complexity)} />
                                    ) : (
                                        <span style={{ color: '#9ca3af', fontSize: 12 }}>—</span>
                                    )}
                                </td>

                                {/* Raw EPA */}
                                <td
                                    style={{
                                        padding: '8px 12px',
                                        color: '#000',
                                        textAlign: 'center',
                                        fontWeight: 600,
                                    }}
                                    title={
                                        proc.oepa
                                            ? getEPADescription(proc.oepa)
                                            : 'No EPA score recorded'
                                    }
                                >
                                    {proc.oepa && Number(proc.oepa) > 0 ? (
                                        proc.oepa
                                    ) : (
                                        <span style={{ color: '#9ca3af', fontWeight: 400, fontSize: 12 }}>
                                            —
                                        </span>
                                    )}
                                </td>

                                {/* Adjusted EPA */}
                                <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                    {(() => {
                                        if (adjustedStatsLoading) {
                                            return (
                                                <span style={{ color: '#9ca3af', fontSize: 12 }}>…</span>
                                            );
                                        }
                                        if (!proc.oepa || Number(proc.oepa) <= 0) {
                                            return (
                                                <span
                                                    style={{ color: '#9ca3af', fontWeight: 400, fontSize: 12 }}
                                                >
                                                    —
                                                </span>
                                            );
                                        }
                                        const adj = adjustedEpaByReportId[proc.report_id];
                                        if (!adj) {
                                            return (
                                                <span
                                                    style={{ color: '#9ca3af', fontWeight: 400, fontSize: 12 }}
                                                >
                                                    —
                                                </span>
                                            );
                                        }

                                        const delta = adj.adjustedScore - proc.oepa;
                                        const deltaStr =
                                            delta > 0.005
                                                ? `+${delta.toFixed(2)}`
                                                : delta < -0.005
                                                ? delta.toFixed(2)
                                                : '±0';

                                        const tooltipLines = [
                                            `Raw EPA: ${proc.oepa}`,
                                            `Difficulty: +${adj.procedureDifficultyWeight.toFixed(3)}`,
                                            `Complexity: +${adj.complexityAdjustment.toFixed(3)}`,
                                            adj.evaluatorDetails.length > 0
                                                ? `Panel Evaluator Bias: ${
                                                      adj.evaluatorAdjustment >= 0 ? '+' : ''
                                                  }${adj.evaluatorAdjustment.toFixed(3)}`
                                                : 'Evaluator correction not applied (insufficient history)',
                                        ];

                                        const isPositive = delta > 0.005;
                                        const isNegative = delta < -0.005;

                                        return (
                                            <div
                                                title={tooltipLines.join('\n')}
                                                style={{
                                                    display: 'flex',
                                                    flexDirection: 'row',    // ← was 'column'
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    gap: 4,                  // ← space between score and delta
                                                    cursor: 'context-menu',
                                                }}
                                            >
                                                <span style={{ fontWeight: 600, color: '#0f172a' }}>
                                                    {adj.adjustedScore.toFixed(2)}
                                                </span>
                                                <span
                                                    style={{
                                                        fontSize: 9,         // ← smaller than before
                                                        fontWeight: 500,
                                                        opacity: 0.55,
                                                        color: isPositive
                                                            ? '#166534'
                                                            : isNegative
                                                            ? '#991b1b'
                                                            : '#6b7280',
                                                        lineHeight: 1,
                                                        marginTop: 1,        // ← nudges it onto the text baseline
                                                    }}
                                                >
                                                    {deltaStr}
                                                </span>
                                            </div>
                                        );
                                    })()}
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
    );
}