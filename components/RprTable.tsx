"use client";

import React, { useEffect, useState, useMemo } from 'react';

type Row = {
  accession?: string | null;
  createdate?: string | null;
  exam_final_date?: string | null;
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
  // timeframe/month filtering removed for table — show all reports for this trainee
  const [procedureFilter, setProcedureFilter] = useState<string>('');
  const [rprFilter, setRprFilter] = useState<string>('all');

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

  useEffect(() => {
    // timeframe/month UI removed for table — nothing to fetch here
    return () => {};
  }, []);

  // (no months fetch here) keep timeframe as simple relative ranges
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

  // Apply table-only filters: procedure name and rpr score
  const finalRows = useMemo(() => {
    let out = (displayedRows || []).slice();

    // procedure name filter (substring, case-insensitive)
    if (procedureFilter && procedureFilter.trim() !== '') {
      const q = procedureFilter.trim().toLowerCase();
      out = out.filter((r) => (r.procedure_name || '').toString().toLowerCase().includes(q));
    }

    // rpr score filter
    if (rprFilter && rprFilter !== 'all') {
      const rv = Number(rprFilter);
      out = out.filter((r) => Number(r.rpr_number_value) === rv);
    }

    return out;
  }, [displayedRows, procedureFilter, rprFilter]);

  // derive unique procedure names for dropdown
  const procedureOptions = useMemo(() => {
    const set = new Set<string>();
    (displayedRows || []).forEach((r) => {
      const name = (r.procedure_name || '').toString().trim();
      if (name) set.add(name);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [displayedRows]);
  return (
    <div style={{ background: '#fff', padding: 16, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', height: '100%' }}>
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'nowrap' }}>
    <div style={{ fontWeight: 700, fontSize: 16, color: '#111827' }}>Recent RPR Reports</div>

  <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end', minWidth: 0, flexWrap: 'nowrap', marginLeft: 'auto' }}>
          {/* timeframe removed for table; parent provides the trainee's rows */}

          <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
            <label htmlFor="rpr_table_proc" style={{ fontSize: 12, fontWeight: 700, marginRight: 8, color: '#374151' }}>Procedure</label>
            <select
              id="rpr_table_proc"
              value={procedureFilter}
              onChange={(e) => setProcedureFilter(e.target.value)}
              style={{ padding: '6px 34px 6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)', background: 'rgba(175,213,240,0.06)', fontWeight: 700, fontSize: 13, color: '#374151', minWidth: 160, maxWidth: 220, width: 'auto', flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              <option value="">All</option>
              {procedureOptions.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
            <label htmlFor="rpr_table_score" style={{ fontSize: 12, fontWeight: 700, marginRight: 8, color: '#374151' }}>RPR</label>
            <select
              id="rpr_table_score"
              value={rprFilter}
              onChange={(e) => setRprFilter(e.target.value)}
              style={{ padding: '6px 22px 6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)', background: 'rgba(175,213,240,0.06)', fontWeight: 700, fontSize: 13, color: '#374151', cursor: 'pointer', minWidth: 120, width: 'auto' }}
            >
              <option value="all">All</option>
              <option value="1">RPR1</option>
              <option value="2">RPR2</option>
              <option value="3">RPR3</option>
              <option value="4">RPR4</option>
            </select>
          </div>
        </div>
      </div>

      <div style={{ maxHeight: 520, overflowY: 'auto', overflowX: 'hidden', border: '1px solid #e9ecef', borderRadius: 12, background: '#fff', minHeight: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', color: '#0f172a', tableLayout: 'fixed', fontSize: 13 }}>
          <thead style={{ position: 'sticky', top: 0, background: '#f8f9fa', zIndex: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.04)', borderTopLeftRadius: 12, borderTopRightRadius: 12 }}>
            <tr>
              {/* Accession removed from RPR dashboards - column intentionally omitted */}

              {/* FIXED PROCEDURE WIDTH */}
              <th style={{ padding: '4px 6px', textAlign: 'left', color: '#495057', fontWeight: 600, borderBottom: '1px solid #dee2e6', width: 200 }}>
                Procedure
              </th>

              <th style={{ padding: '4px 6px', textAlign: 'left', color: '#495057', fontWeight: 600, borderBottom: '1px solid #dee2e6', width: 160 }}>
                Trainee
              </th>

              <th style={{ padding: '4px 6px', textAlign: 'center', color: '#495057', fontWeight: 600, borderBottom: '1px solid #dee2e6', width: 60 }}>
                RPR
              </th>
            </tr>
          </thead>

          <tbody>
            {finalRows.map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                {/* MATCH PROCEDURE WIDTH */}
                <td style={{
                  padding: '4px 6px',
                  verticalAlign: 'top',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  width: 200
                }}>
                  {r.procedure_name ?? ''}
                </td>

                <td style={{ padding: '4px 6px', verticalAlign: 'top', width: 160 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0, lineHeight: 1.05 }}>
                    <span style={{ fontWeight: 600, color: '#111827', fontSize: 13, lineHeight: 1 }}>
                      {r.trainee_name ?? r.first_resident ?? ''}
                    </span>
                    <span style={{ fontSize: 12, color: '#6b7280', marginTop: 0, lineHeight: 1 }}>
                      {r.attending_name ?? r.signing_md ?? ''}
                    </span>
                  </div>
                </td>
                <td style={{ padding: '4px 6px', verticalAlign: 'top', textAlign: 'center', width: 60 }}>
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
