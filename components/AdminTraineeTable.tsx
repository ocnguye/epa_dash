"use client";

import React from 'react';
import { useRouter } from 'next/navigation';

type Trainee = {
    user_id: number;
    preferred_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    role?: string | null;
    pgy?: number | null;
    specialty?: string | null;
    avg_epa?: number | null;
    report_count?: number;
};

export default function AdminTraineeTable({ trainees }: { trainees: Trainee[] }) {
    const router = useRouter();

    return (
        <div style={{
            overflowX: 'auto',
            overflowY: 'auto',
            maxHeight: 'calc(100vh - 240px)',
            border: '1px solid #e9ecef',
            borderRadius: 6,
            fontSize: 13,
        }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800, color: '#0f172a' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#f8f9fa', zIndex: 1, boxShadow: '0 2px 6px rgba(0,0,0,0.06)' }}>
                    <tr>
                        <th style={{ padding: '8px 12px', textAlign: 'left', color: '#495057', fontWeight: 600, borderBottom: '1px solid #dee2e6' }}>Name</th>
                        <th style={{ padding: '8px 12px', textAlign: 'left', color: '#495057', fontWeight: 600, borderBottom: '1px solid #dee2e6' }}>Role</th>
                        <th style={{ padding: '8px 12px', textAlign: 'left', color: '#495057', fontWeight: 600, borderBottom: '1px solid #dee2e6' }}>PGY</th>
                        <th style={{ padding: '8px 12px', textAlign: 'left', color: '#495057', fontWeight: 600, borderBottom: '1px solid #dee2e6' }}>Specialty</th>
                        <th style={{ padding: '8px 12px', textAlign: 'left', color: '#495057', fontWeight: 600, borderBottom: '1px solid #dee2e6' }}>Avg EPA</th>
                        <th style={{ padding: '8px 12px', textAlign: 'left', color: '#495057', fontWeight: 600, borderBottom: '1px solid #dee2e6' }}>Reports</th>
                        <th style={{ padding: '8px 12px', borderBottom: '1px solid #dee2e6' }}></th>
                    </tr>
                </thead>
                <tbody>
                    {trainees.map(t => (
                        <tr key={t.user_id} style={{ borderBottom: '1px solid #f8f9fa' }}>
                            <td style={{ padding: '8px 12px', color: '#000' }}>
                                <div style={{ fontWeight: 600 }}>
                                    {(t.preferred_name && String(t.preferred_name).trim())
                                        ? `${String(t.preferred_name).trim()} ${t.last_name ?? ''}`.trim()
                                        : `${t.first_name ?? ''} ${t.last_name ?? ''}`.trim()}
                                </div>
                            </td>
                            <td style={{ padding: '8px 12px', color: '#000', textTransform: 'capitalize' }}>{t.role ?? ''}</td>
                            <td style={{ padding: '8px 12px', color: '#000' }}>{t.pgy ?? ''}</td>
                            <td style={{ padding: '8px 12px', color: '#000' }}>{t.specialty ?? 'Interventional Radiology'}</td>
                            <td style={{ padding: '8px 12px', color: '#000' }}>
                                {typeof t.avg_epa === 'number'
                                    ? (t.avg_epa.toFixed ? t.avg_epa.toFixed(2) : t.avg_epa)
                                    : (t.avg_epa ?? 0)}
                            </td>
                            <td style={{ padding: '8px 12px', color: '#000' }}>{t.report_count ?? 0}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                                <button
                                    onClick={() => router.push(`/adminepa/trainee/${t.user_id}`)}
                                    style={{ background: 'linear-gradient(135deg, #4a90e2, #2b7bd3)', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 12 }}
                                >
                                    View
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}