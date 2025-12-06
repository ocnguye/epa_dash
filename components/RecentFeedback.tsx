"use client";

import React from 'react';

type Procedure = {
    report_id: number;
    create_date: string;
    proc_desc: string;
    proc_code?: string | null;
    seek_feedback: 'not_required' | 'feedback_requested' | 'discussed' | string;
    attending_name?: string | null;
};

export default function RecentFeedback({ procedures, loading, onUpdateStatus } : { procedures: Procedure[]; loading: boolean; onUpdateStatus?: (id: number, status: string) => void }) {
    return (
        <div style={{
            background: '#fff',
            borderRadius: 12,
            padding: 24,
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        }}>
            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 16, color: '#000' }}>
                Recent Feedback
            </div>
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {loading ? (
                    <div style={{ color: '#888', textAlign: 'center' }}>Loading...</div>
                ) : (
                    procedures.map((proc) => (
                        <div key={proc.report_id} style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #f0f0f0' }}>
                            <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
                                {(() => {
                                    const [year, month, day] = (proc.create_date || '').split('-');
                                    const date = new Date(parseInt(year || '0'), parseInt((month || '1')) - 1, parseInt(day || '1'));
                                    return isNaN(date.getTime()) ? proc.create_date : date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
                                })()}
                            </div>
                            <div style={{ fontWeight: 600, color: '#000', fontSize: 14, marginBottom: 4 }}>
                                {proc.proc_desc}
                            </div>

                            <div style={{ position: 'relative', display: 'inline-block', width: 160 }}>
                                <select
                                    value={proc.seek_feedback}
                                    onChange={(e) => onUpdateStatus ? onUpdateStatus(proc.report_id, e.target.value) : undefined}
                                    title={String(proc.seek_feedback)}
                                    style={{
                                        padding: '4px 8px',
                                        paddingRight: '30px',
                                        borderRadius: 6,
                                        fontSize: 11,
                                        fontWeight: 600,
                                        display: 'inline-block',
                                        width: '100%',
                                        textAlign: 'center',
                                        cursor: onUpdateStatus ? 'pointer' : 'default',
                                        border: '1px solid rgba(0,0,0,0.06)',
                                        backgroundColor: '#fff',
                                        color: '#111827',
                                        WebkitAppearance: 'none',
                                        MozAppearance: 'none',
                                        appearance: 'none',
                                    }}
                                >
                                    <option value="not_required">Not Required</option>
                                    <option value="feedback_requested">Feedback Requested</option>
                                    <option value="discussed">Discussed</option>
                                </select>
                                <svg viewBox="0 0 10 6" style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', width: 8, height: 5, pointerEvents: 'none', color: '#6b7280' }} xmlns="http://www.w3.org/2000/svg">
                                    <path d="M0 0 L5 6 L10 0" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
