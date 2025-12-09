"use client";

import React, { useEffect, useState, useMemo } from 'react';

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
  trainee_user_id?: number | null;
};

export default function RprTable({ rows }: { rows: Row[] }) {
  const [user, setUser] = useState<any | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch('/api/user', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then((p) => {
        if (!mounted) return;
        if (p && p.success && p.user) setUser(p.user);
      })
      .catch(() => {})
    return () => { mounted = false; };
  }, []);

  const displayedRows = useMemo(() => {
    if (!user) return rows;
    const uid = Number(user.user_id);
    const first = (user.first_name || '').toString().trim().toLowerCase();
    const last = (user.last_name || '').toString().trim().toLowerCase();
    const preferred = (user.preferred_name || '').toString().trim().toLowerCase();
    const username = (user.username || '').toString().trim().toLowerCase();

    return (rows || []).filter((r) => {
      // If the report has a trainee_user_id, require it to match
      if (typeof r.trainee_user_id === 'number') return Number(r.trainee_user_id) === uid;

      // Otherwise fallback to matching by trainee_name or first_resident text
      const tname = (r.trainee_name || '') .toString().trim().toLowerCase();
      const fres = (r.first_resident || '') .toString().trim().toLowerCase();

      if (tname) {
        if (tname === `${first} ${last}`) return true;
        if (preferred && tname.includes(preferred)) return true;
        if (username && tname.includes(username)) return true;
      }

      if (fres) {
        if (fres.includes(first) || fres.includes(last) || (preferred && fres.includes(preferred))) return true;
      }

      return false;
    });
  }, [rows, user]);
  return (
    <div style={{ background: '#fff', padding: 16, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12, color: '#111827' }}>Recent RPR Reports</div>

  <div style={{ maxHeight: 420, overflowY: 'auto', overflowX: 'hidden', border: '1px solid #e9ecef', borderRadius: 12, background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', color: '#0f172a', tableLayout: 'fixed', fontSize: 13 }}>
          <thead style={{ position: 'sticky', top: 0, background: '#f8f9fa', zIndex: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.04)', borderTopLeftRadius: 12, borderTopRightRadius: 12 }}>
            <tr>
              <th style={{ padding: '6px 8px', textAlign: 'left', color: '#495057', fontWeight: 600, borderBottom: '1px solid #dee2e6', width: 80 }}>
                Accession
              </th>

              {/* FIXED PROCEDURE WIDTH */}
              <th style={{ padding: '6px 4px 6px 8px', textAlign: 'left', color: '#495057', fontWeight: 600,
                borderBottom: '1px solid #dee2e6', width: 200 }}>
                Procedure
              </th>

              <th style={{ padding: '6px 8px 6px 4px', textAlign: 'left', color: '#495057', fontWeight: 600, borderBottom: '1px solid #dee2e6', width: 120 }}>
                Trainee
              </th>

              <th style={{ padding: '6px 8px', textAlign: 'center', color: '#495057', fontWeight: 600, borderBottom: '1px solid #dee2e6', width: 60 }}>
                RPR
              </th>
            </tr>
          </thead>

          <tbody>
            {displayedRows.map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '6px 8px', verticalAlign: 'top', width: 80 }}>
                  {r.accession ?? ''}
                </td>

                {/* MATCH PROCEDURE WIDTH */}
                <td style={{
                  padding: '6px 4px 6px 8px',
                  verticalAlign: 'top',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  width: 200
                }}>
                  {r.procedure_name ?? ''}
                </td>

                <td style={{ padding: '6px 8px 6px 4px', verticalAlign: 'top', width: 120 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0, lineHeight: 1.05 }}>
                    <span style={{ fontWeight: 600, color: '#111827', fontSize: 13, lineHeight: 1 }}>
                      {r.trainee_name ?? r.first_resident ?? ''}
                    </span>
                    <span style={{ fontSize: 12, color: '#6b7280', marginTop: 0, lineHeight: 1 }}>
                      {r.attending_name ?? r.signing_md ?? ''}
                    </span>
                  </div>
                </td>

                <td style={{ padding: '6px 8px', verticalAlign: 'top', textAlign: 'center', width: 60 }}>
                  {typeof r.rpr_number_value === 'number' ? r.rpr_number_value : ''}
                </td>
              </tr>
            ))}
          </tbody>

        </table>
      </div>
    </div>
  );
}
