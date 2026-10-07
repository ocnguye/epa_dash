'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

type Profile = { user_id: number; role: string; username: string; first_name: string | null; last_name: string | null; active: boolean };
type Person = { sso_identity_id: number; email: string | null; display_name: string | null; profiles: Profile[] };

const COLORS = { blue: 'rgba(175, 213, 240, 0.6)', green: 'rgba(178, 211, 194, 0.6)', red: 'rgba(255, 126, 112, 0.6)', purple: 'rgba(200, 206, 238, 0.6)' };
const BORDERS = { blue: '#afd5f0', green: '#b2d3c2', red: '#ff7e70', purple: '#c8ceee' };
const ROLES = ['trainee', 'attending', 'admin'];

const card: React.CSSProperties = { background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 6px 24px rgba(15,23,42,0.06)', boxSizing: 'border-box' };
const smallBtn: React.CSSProperties = { padding: '4px 10px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontSize: 13, color: '#374151', fontFamily: 'inherit' };
const primaryBtn: React.CSSProperties = { padding: '6px 12px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #3b82f6, #2563eb)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };

export default function ManageAccessPanel() {
  const [people, setPeople] = useState<Person[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [newRole, setNewRole] = useState<Record<number, string>>({});
  
  const [choice, setChoice] = useState<{
    identityId: number; role: string; who: string;
    candidates: { user_id: number; first_name: string | null; last_name: string | null; username: string; email: string | null }[];
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/people');
      if (!res.ok) { setMsg({ ok: false, text: `Could not load the list (error ${res.status}).` }); return; }
      const d = await res.json();
      setPeople(d.people ?? []);
      setLoaded(true);
    } catch {
      setMsg({ ok: false, text: 'Network error. Please refresh the page.' });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return people.filter(p =>
      !f || `${p.display_name ?? ''} ${p.email ?? ''} ${p.profiles.map(x => x.role).join(' ')}`.toLowerCase().includes(f));
  }, [people, filter]);

  async function act(body: any) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/people', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (d.needs_choice) {
        const p = people.find(x => x.sso_identity_id === body.identityId);
        setChoice({
          identityId: body.identityId,
          role: body.role,
          who: p?.display_name || p?.email || 'this person',
          candidates: d.candidates ?? [],
        });
      } else {
        setChoice(null);
        setMsg(res.ok
          ? { ok: true, text: `Done: ${d.message}. Changes take effect immediately.` }
          : { ok: false, text: d.message || `Something went wrong (error ${res.status}).` });
        if (res.ok) await load();
      }
    } catch {
      setMsg({ ok: false, text: 'Network error. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  function toggle(p: Person, pr: Profile) {
    const who = p.display_name || p.email || 'this person';
    if (pr.active && !window.confirm(`Remove ${pr.role} access for ${who}? Their history is kept.`)) return;
    if (!pr.active && pr.role === 'admin' && !window.confirm(`Restore ADMIN access for ${who}?`)) return;
    act({ action: pr.active ? 'disable' : 'enable', identityId: p.sso_identity_id, userId: pr.user_id });
  }

  function addRole(p: Person) {
    const role = newRole[p.sso_identity_id];
    if (!role) return;
    const who = p.display_name || p.email || 'this person';
    if (role === 'admin' && !window.confirm(`Give ${who} ADMIN access?`)) return;
    act({ action: 'add_role', identityId: p.sso_identity_id, role });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {msg && (
        <div role="status" style={{ borderRadius: 10, padding: '10px 14px', fontSize: 14, fontWeight: 600,
          background: msg.ok ? COLORS.green : COLORS.red, border: `1px solid ${msg.ok ? BORDERS.green : BORDERS.red}`,
          color: msg.ok ? '#1a5c30' : '#a02010' }}>
          {msg.text}
        </div>
      )}

        {choice && (
            <div style={{ ...card, border: `1px solid ${BORDERS.blue}` }}>
            <h2 style={{ fontWeight: 700, color: '#374151', fontSize: 15, margin: 0, textTransform: 'capitalize' }}>
                Existing {choice.role} profiles found for {choice.who}
            </h2>
            <p style={{ fontSize: 13, color: '#4b5563', margin: '4px 0 12px 0' }}>
                These profiles are not connected to anyone and look like they could be the same person.
                Connect the right one to keep their history, or create a new profile if none of them is them.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                {choice.candidates.map(c => (
                <div key={c.user_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: 8 }}>
                    <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{`${c.first_name ?? ''} ${c.last_name ?? ''}`.trim()}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{c.username}{c.email ? ` · ${c.email}` : ''}</div>
                    </div>
                    <button disabled={busy} style={primaryBtn}
                    onClick={() => act({ action: 'add_role', identityId: choice.identityId, role: choice.role, userId: c.user_id })}>
                    Connect this one
                    </button>
                </div>
                ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
                <button disabled={busy} style={smallBtn}
                onClick={() => act({ action: 'add_role', identityId: choice.identityId, role: choice.role, create_new: true })}>
                None of these, create a new profile
                </button>
                <button disabled={busy} style={smallBtn} onClick={() => setChoice(null)}>Cancel</button>
            </div>
            </div>
        )}

      <div style={card}>
        <h2 style={{ fontWeight: 700, color: '#374151', fontSize: 15, margin: 0 }}>People with access ({visible.length})</h2>
        <p style={{ fontSize: 13, color: '#4b5563', margin: '4px 0 12px 0' }}>
          Add a role to give someone another dashboard, or remove a role to take one away.
          Removing keeps their reports and scores.
        </p>
        <input
          style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 14, marginBottom: 12, fontFamily: 'inherit' }}
          placeholder="Search by name, email, or role"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />

        {!loaded ? (
          <div style={{ fontSize: 14, color: '#4b5563' }}>Loading…</div>
        ) : visible.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: '#6b7280', fontSize: 14 }}>No one matches.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {visible.map(p => {
              const have = new Set(p.profiles.filter(x => x.active).map(x => x.role));
              const addable = ROLES.filter(r => !have.has(r));
              return (
                <div key={p.sso_identity_id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>{p.display_name || '(no name)'}</div>
                  <div style={{ fontSize: 13, color: '#4b5563', marginBottom: 8 }}>{p.email}</div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                    {p.profiles.map(pr => (
                      <span key={pr.user_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 4px 4px 10px', borderRadius: 8,
                        background: pr.active ? COLORS.purple : '#f3f4f6', border: `1px solid ${pr.active ? BORDERS.purple : '#e5e7eb'}`,
                        fontSize: 13, color: '#111827', textTransform: 'capitalize', opacity: pr.active ? 1 : 0.8 }}>
                        {pr.role}{!pr.active && ' (removed)'}
                        <button disabled={busy} onClick={() => toggle(p, pr)} style={smallBtn}>
                          {pr.active ? 'Remove' : 'Restore'}
                        </button>
                      </span>
                    ))}
                  </div>

                  {addable.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <select
                        style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, fontFamily: 'inherit', textTransform: 'capitalize' }}
                        value={newRole[p.sso_identity_id] ?? ''}
                        onChange={e => setNewRole(r => ({ ...r, [p.sso_identity_id]: e.target.value }))}
                      >
                        <option value="">Add a role…</option>
                        {addable.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <button
                        disabled={busy || !newRole[p.sso_identity_id]}
                        onClick={() => addRole(p)}
                        style={{ ...primaryBtn, opacity: busy || !newRole[p.sso_identity_id] ? 0.5 : 1 }}
                      >
                        Add
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}