'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type Ident = {
  sso_identity_id: number;
  email: string | null;
  display_name: string | null;
  netid: string | null;
  last_login_at: string | null;
};
type UserRow = {
  user_id: number;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  username: string;
  role: string;
  email: string | null;
};

const COLORS = { blue: 'rgba(175, 213, 240, 0.6)', green: 'rgba(178, 211, 194, 0.6)', red: 'rgba(255, 126, 112, 0.6)' };
const BORDERS = { blue: '#afd5f0', green: '#b2d3c2', red: '#ff7e70' };

const norm = (s?: string | null) => (s ?? '').trim().toLowerCase();
const fullName = (u: UserRow) => `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();

const ROLE_HELP: Record<string, string> = {
  trainee: 'Sees their own EPA scores and reports.',
  attending: 'Sees their trainees and reports.',
  admin: 'Sees program-wide data and can use this tool. Grant with care.',
};

const card: React.CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: 18,
  boxShadow: '0 6px 24px rgba(15,23,42,0.06)',
  boxSizing: 'border-box',
};
const sectionTitle: React.CSSProperties = { fontWeight: 700, color: '#374151', fontSize: 15, margin: 0 };
const hint: React.CSSProperties = { fontSize: 13, color: '#4b5563', margin: '4px 0 12px 0' };
const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid #d1d5db',
  fontSize: 14,
  color: '#111827',
  background: '#fff',
  fontFamily: 'inherit',
};
const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#374151', display: 'block' };
const primaryBtn: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: 'none',
  background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

export default function AdminLinkingPanel() {
  const router = useRouter();
  const [identities, setIdentities] = useState<Ident[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<Ident | null>(null);
  const [tab, setTab] = useState<'connect' | 'create'>('connect');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState({ role: 'trainee', first_name: '', last_name: '', username: '' });

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/linking');
      if (!res.ok) { setMsg({ ok: false, text: `Could not load the list (error ${res.status}).` }); return; }
      const d = await res.json();
      setIdentities(d.identities ?? []);
      setUsers(d.users ?? []);
      setLoaded(true);
    } catch {
      setMsg({ ok: false, text: 'Network error. Please refresh the page.' });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function pick(i: Ident) {
    setSelected(i);
    setMsg(null);
    setFilter('');
    setTab('connect');
    const parts = (i.display_name ?? '').trim().split(/\s+/).filter(Boolean);
    setForm({
      role: 'trainee',
      first_name: parts[0] ?? '',
      last_name: parts.slice(1).join(' '),
      username: (i.email ?? '').split('@')[0].toLowerCase(),
    });
  }

  const isSuggested = useCallback((u: UserRow) => {
    if (!selected) return false;
    const e = norm(selected.email);
    if (e && norm(u.email) === e) return true;
    const dn = norm(selected.display_name);
    return !!dn && dn === norm(fullName(u));
  }, [selected]);

  const visibleUsers = useMemo(() => {
    const f = norm(filter);
    const list = users.filter(u =>
      !f || `${fullName(u)} ${u.username} ${u.role} ${u.email ?? ''}`.toLowerCase().includes(f));
    return list.sort((a, b) => Number(isSuggested(b)) - Number(isSuggested(a)));
  }, [users, filter, isSuggested]);

  async function post(body: any, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/linking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ ok: false, text: d.message || `Something went wrong (error ${res.status}).` });
      } else {
        setMsg({ ok: true, text: okText });
        setSelected(null);
        await load();
        router.refresh();
      }
    } catch {
      setMsg({ ok: false, text: 'Network error. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  function link(u: UserRow) {
    if (!selected) return;
    const who = selected.display_name || selected.email || 'this person';
    const label = `${fullName(u)} (${u.role})`;
    if (u.role === 'admin' && !window.confirm(`Give ${who} ADMIN access by connecting them to ${label}?`)) return;
    post(
      { action: 'link', identityId: selected.sso_identity_id, userId: u.user_id },
      `${who} is now connected to ${label}. They’ll see it the next time they sign in.`,
    );
  }

  function create() {
    if (!selected) return;
    const who = selected.display_name || selected.email || 'this person';
    if (form.role === 'admin' && !window.confirm(`Create an ADMIN profile for ${who}?`)) return;
    post(
      { action: 'create', identityId: selected.sso_identity_id, ...form },
      `A ${form.role} profile was created for ${who}. They’ll see it the next time they sign in.`,
    );
  }

  const tabBtn = (t: 'connect' | 'create', text: string) => (
    <button
      onClick={() => setTab(t)}
      style={{
        fontSize: 13,
        padding: '5px 14px',
        borderRadius: 6,
        cursor: 'pointer',
        fontFamily: 'inherit',
        border: `1px solid ${tab === t ? BORDERS.blue : '#e5e7eb'}`,
        background: tab === t ? COLORS.blue : '#fff',
        color: '#374151',
        fontWeight: tab === t ? 700 : 400,
      }}
    >
      {text}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {msg && (
        <div
          role="status"
          style={{
            borderRadius: 10,
            padding: '10px 14px',
            fontSize: 14,
            fontWeight: 600,
            background: msg.ok ? COLORS.green : COLORS.red,
            border: `1px solid ${msg.ok ? BORDERS.green : BORDERS.red}`,
            color: msg.ok ? '#1a5c30' : '#a02010',
          }}
        >
          {msg.text}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
        {/* LEFT: awaiting */}
        <div style={card}>
          <h2 style={sectionTitle}>Awaiting profile setup ({identities.length})</h2>
          <p style={hint}>Emory users who have signed in but have no profile yet.</p>

          {!loaded ? (
            <div style={{ fontSize: 14, color: '#4b5563' }}>Loading…</div>
          ) : identities.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: '#6b7280', fontSize: 14 }}>
              No one is waiting. Everyone who has signed in is connected to a profile.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 520, overflowY: 'auto' }}>
              {identities.map(i => {
                const active = selected?.sso_identity_id === i.sso_identity_id;
                return (
                  <button
                    key={i.sso_identity_id}
                    onClick={() => pick(i)}
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      borderRadius: 8,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      background: active ? COLORS.blue : '#fff',
                      border: `1px solid ${active ? BORDERS.blue : '#e5e7eb'}`,
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>
                      {i.display_name || '(no name provided)'}
                    </div>
                    <div style={{ fontSize: 13, color: '#374151' }}>{i.email}</div>
                    {i.last_login_at && (
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                        Last signed in {new Date(i.last_login_at).toLocaleString()}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT: action */}
        <div style={card}>
          {!selected ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: '#6b7280', fontSize: 14 }}>
              Select a person on the left to set up their access.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>Setting up access for</div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: '#111827' }}>
                    {selected.display_name || selected.email}
                  </div>
                  {selected.display_name && selected.email && (
                    <div style={{ fontSize: 13, color: '#4b5563' }}>{selected.email}</div>
                  )}
                </div>
                <button
                  onClick={() => setSelected(null)}
                  style={{ background: 'transparent', border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13, color: '#6b7280', fontFamily: 'inherit' }}
                >
                  Cancel
                </button>
              </div>

              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                {tabBtn('connect', 'Connect existing profile')}
                {tabBtn('create', 'Create new profile')}
              </div>

              {tab === 'connect' ? (
                <>
                  <p style={{ ...hint, marginTop: 0 }}>
                    For people who already have a profile (for example, from the roster).
                    “Suggested” matches by name or email, so confirm it’s the same person.
                  </p>
                  <input
                    style={{ ...inputStyle, marginBottom: 10 }}
                    placeholder="Search by name, username, or role"
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
                    {visibleUsers.length === 0 ? (
                      <div style={{ padding: '16px 0', textAlign: 'center', color: '#6b7280', fontSize: 14 }}>
                        No unconnected profiles match. Try “Create new profile.”
                      </div>
                    ) : visibleUsers.map(u => (
                      <div
                        key={u.user_id}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: 8 }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>
                            {fullName(u)}{' '}
                            <span style={{ fontWeight: 400, color: '#4b5563', textTransform: 'capitalize' }}>· {u.role}</span>
                            {isSuggested(u) && (
                              <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: COLORS.green, color: '#1a5c30', border: `1px solid ${BORDERS.green}` }}>
                                Suggested
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: '#6b7280' }}>
                            {u.username}{u.email ? ` · ${u.email}` : ''}
                          </div>
                        </div>
                        <button
                          disabled={busy}
                          onClick={() => link(u)}
                          style={{ ...primaryBtn, opacity: busy ? 0.5 : 1, flexShrink: 0 }}
                        >
                          Connect
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <p style={{ ...hint, marginTop: 0 }}>
                    For new people with no profile. No password is needed since they sign in
                    with Emory.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <label style={labelStyle}>First name
                      <input style={{ ...inputStyle, marginTop: 4 }} value={form.first_name}
                        onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} />
                    </label>
                    <label style={labelStyle}>Last name
                      <input style={{ ...inputStyle, marginTop: 4 }} value={form.last_name}
                        onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} />
                    </label>
                    <label style={labelStyle}>Username
                      <input style={{ ...inputStyle, marginTop: 4 }} value={form.username}
                        onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
                    </label>
                    <label style={labelStyle}>Role
                      <select style={{ ...inputStyle, marginTop: 4 }} value={form.role}
                        onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                        <option value="trainee">Trainee</option>
                        <option value="attending">Attending</option>
                        <option value="admin">Admin</option>
                      </select>
                    </label>
                  </div>
                  <p style={{ fontSize: 13, color: '#4b5563', margin: '8px 0 12px 0' }}>{ROLE_HELP[form.role]}</p>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button disabled={busy} onClick={create} style={{ ...primaryBtn, opacity: busy ? 0.5 : 1 }}>
                      {busy ? 'Saving…' : 'Create profile and connect'}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}