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
    <div style={{ background: '#fff', padding: 12, borderRadius: 8, boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', color: '#333' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #eee', color: '#222' }}>
            <th style={{ padding: '8px 6px' }}>Accession</th>
            <th style={{ padding: '8px 6px' }}>Date</th>
            <th style={{ padding: '8px 6px' }}>Procedure</th>
            <th style={{ padding: '8px 6px' }}>Trainee</th>
            <th style={{ padding: '8px 6px' }}>Attending</th>
            <th style={{ padding: '8px 6px' }}>RPR (raw)</th>
            <th style={{ padding: '8px 6px' }}>RPR (value)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #f6f6f6', color: '#333' }}>
              <td style={{ padding: '8px 6px', fontSize: 13 }}>{r.accession ?? ''}</td>
              <td style={{ padding: '8px 6px', fontSize: 13 }}>{r.createdate ?? ''}</td>
              <td style={{ padding: '8px 6px', fontSize: 13 }}>{r.procedure_name ?? ''}</td>
              <td style={{ padding: '8px 6px', fontSize: 13 }}>{r.trainee_name ?? r.first_resident ?? ''}</td>
              <td style={{ padding: '8px 6px', fontSize: 13 }}>{r.attending_name ?? r.signing_md ?? ''}</td>
              <td style={{ padding: '8px 6px', fontSize: 13 }}>{r.rpr_number_raw ?? ''}</td>
              <td style={{ padding: '8px 6px', fontSize: 13 }}>{typeof r.rpr_number_value === 'number' ? r.rpr_number_value : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
