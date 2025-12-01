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
        <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
                <thead>
                    <tr style={{ textAlign: 'left' }}>
                        <th style={{ padding: '12px 18px', fontSize: 13, color: '#374151' }}>Name</th>
                        <th style={{ padding: '12px 18px', fontSize: 13, color: '#374151' }}>Role</th>
                        <th style={{ padding: '12px 18px', fontSize: 13, color: '#374151' }}>PGY</th>
                        <th style={{ padding: '12px 18px', fontSize: 13, color: '#374151' }}>Specialty</th>
                        <th style={{ padding: '12px 18px', fontSize: 13, color: '#374151' }}>Avg EPA</th>
                        <th style={{ padding: '12px 18px', fontSize: 13, color: '#374151' }}>Reports</th>
                        <th style={{ padding: '12px 18px' }}></th>
                    </tr>
                </thead>
                <tbody>
                    {trainees.map(t => (
                        <tr key={t.user_id} style={{ borderTop: '1px solid #f6f6f8' }}>
                            <td style={{ padding: '14px 18px', color: '#374151' }}>
                                <div style={{ fontWeight: 700 }}>{(t.preferred_name && String(t.preferred_name).trim()) ? `${String(t.preferred_name).trim()} ${t.last_name ?? ''}`.trim() : `${t.first_name ?? ''} ${t.last_name ?? ''}`.trim()}</div>
                            </td>
                            <td style={{ padding: '14px 18px', color: '#374151', textTransform: 'capitalize' }}>{t.role ?? ''}</td>
                            <td style={{ padding: '14px 18px', color: '#374151' }}>{t.pgy ?? ''}</td>
                            <td style={{ padding: '14px 18px', color: '#374151' }}>{t.specialty ?? 'Interventional Radiology'}</td>
                            <td style={{ padding: '14px 18px', color: '#374151' }}>{typeof t.avg_epa === 'number' ? (t.avg_epa.toFixed ? t.avg_epa.toFixed(2) : t.avg_epa) : (t.avg_epa ?? 0)}</td>
                            <td style={{ padding: '14px 18px', color: '#374151' }}>{t.report_count ?? 0}</td>
                            <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                                <button onClick={() => router.push(`/admin/trainee/${t.user_id}`)} style={{ background: 'linear-gradient(135deg, #4a90e2, #2b7bd3)', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>View</button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
