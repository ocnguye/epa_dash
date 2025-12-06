import React from 'react';

type Row = {
  rpr_number_raw?: string | null;
  rpr_number_value?: number | null;
};

export default function RprSummary({ rows }: { rows: Row[] }) {
  const total = rows.length;
  const withRpr = rows.filter(r => r.rpr_number_raw || r.rpr_number_value).length;
  const numeric = rows.filter(r => typeof r.rpr_number_value === 'number').length;

  return (
    <div style={{ marginBottom: 16, display: 'flex', gap: 12 }}>
      <div style={{ padding: 12, background: '#fff', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
        <div style={{ fontSize: 12, color: '#333' }}>Total reports</div>
        <div style={{ fontWeight: 700, fontSize: 18, color: '#111' }}>{total}</div>
      </div>
      <div style={{ padding: 12, background: '#fff', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
        <div style={{ fontSize: 12, color: '#333' }}>Reports with RPR</div>
        <div style={{ fontWeight: 700, fontSize: 18, color: '#111' }}>{withRpr}</div>
      </div>
      <div style={{ padding: 12, background: '#fff', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
        <div style={{ fontSize: 12, color: '#333' }}>Numeric RPRs</div>
        <div style={{ fontWeight: 700, fontSize: 18, color: '#111' }}>{numeric}</div>
      </div>
    </div>
  );
}
