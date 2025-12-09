import React from 'react';

type Row = {
  accession?: string | null;
  createdate?: string | null;
  procedure_name?: string | null;
  first_resident?: string | null;
  trainee_name?: string | null;
  signing_md?: string | null;
  attending_name?: string | null;
  rpr_number_raw?: string | null;
  rpr_number_value?: number | null;
};

export default function RprTable({ rows }: { rows: Row[] }) {
  return (
    <div style={{ background: '#fff', padding: 16, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12, color: '#111827' }}>Recent RPR Reports</div>

      <div style={{ maxHeight: 360, overflowY: 'auto', overflowX: 'hidden', border: '1px solid #e9ecef', borderRadius: 12, background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', color: '#0f172a', tableLayout: 'fixed', fontSize: 13 }}>
          <thead style={{ position: 'sticky', top: 0, background: '#f8f9fa', zIndex: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.04)', borderTopLeftRadius: 12, borderTopRightRadius: 12 }}>
            <tr>
              <th style={{ padding: '8px 12px', textAlign: 'left', color: '#495057', fontWeight: 600, borderBottom: '1px solid #dee2e6', width: 90 }}>Accession</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', color: '#495057', fontWeight: 600, borderBottom: '1px solid #dee2e6' }}>Procedure</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', color: '#495057', fontWeight: 600, borderBottom: '1px solid #dee2e6', width: 140 }}>Trainee</th>
              <th style={{ padding: '8px 12px', textAlign: 'center', color: '#495057', fontWeight: 600, borderBottom: '1px solid #dee2e6', width: 60 }}>RPR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '8px 12px', verticalAlign: 'middle', width: 90 }}>{r.accession ?? ''}</td>
                <td style={{ padding: '8px 12px', verticalAlign: 'middle', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.procedure_name ?? ''}</td>
                <td style={{ padding: '8px 12px', verticalAlign: 'middle', width: 140 }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontWeight: 600, color: '#111827', fontSize: 13 }}>{r.trainee_name ?? r.first_resident ?? ''}</span>
                    <span style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{r.attending_name ?? r.signing_md ?? ''}</span>
                  </div>
                </td>
                <td style={{ padding: '8px 12px', verticalAlign: 'middle', textAlign: 'center', width: 60 }}>{typeof r.rpr_number_value === 'number' ? r.rpr_number_value : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
