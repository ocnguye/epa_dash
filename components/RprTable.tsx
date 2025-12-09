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
    // Outer card kept. Header is rendered in its own table so the scrollable area begins after the header.
    <div style={{ background: '#fff', padding: 12, borderRadius: 8, boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}>
      {/* Header table (static) */}
      <table style={{ width: '100%', borderCollapse: 'collapse', color: '#333', tableLayout: 'fixed' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #eee', color: '#222' }}>
            <th style={{ padding: '8px 6px', background: '#fff' }}>Accession</th>
            <th style={{ padding: '8px 6px', background: '#fff' }}>Date</th>
            <th style={{ padding: '8px 6px', background: '#fff' }}>Procedure</th>
            <th style={{ padding: '8px 6px', background: '#fff' }}>Trainee</th>
            <th style={{ padding: '8px 6px', background: '#fff' }}>Attending</th>
            <th style={{ padding: '8px 6px', background: '#fff' }}>RPR (raw)</th>
            <th style={{ padding: '8px 6px', background: '#fff' }}>RPR (value)</th>
          </tr>
        </thead>
      </table>

      {/* Scrollable body starts immediately below header */}
      <div style={{ maxHeight: 360, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', color: '#333', tableLayout: 'fixed' }}>
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
    </div>
  );
}
