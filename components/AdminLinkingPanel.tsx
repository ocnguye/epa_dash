'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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

const norm = (s?: string | null) => (s ?? '').trim().toLowerCase();
const fullName = (u: UserRow) => `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();

export default function AdminLinkingPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [identities, setIdentities] = useState<Ident[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [selected, setSelected] = useState<Ident | null>(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState({ role: 'trainee', first_name: '', last_name: '', username: '' });

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/linking');
      if (!res.ok) { setMsg({ ok: false, text: `Could not load (${res.status})` }); return; }
      const d = await res.json();
      setIdentities(d.identities ?? []);
      setUsers(d.users ?? []);
    } catch {
      setMsg({ ok: false, text: 'Network error' });
    }
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  function pick(i: Ident) {
    setSelected(i);
    setMsg(null);
    setFilter('');
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
        setMsg({ ok: false, text: d.message || `Failed (${res.status})` });
      } else {
        setMsg({ ok: true, text: okText });
        setSelected(null);
        await load();
        router.refresh(); // re-run the page query in case your own tiles changed
      }
    } catch {
      setMsg({ ok: false, text: 'Network error' });
    } finally {
      setBusy(false);
    }
  }

  function link(u: UserRow) {
    if (!selected) return;
    const label = `${fullName(u)} (${u.role})`;
    if (u.role === 'admin' && !window.confirm(`Give ${selected.email ?? 'this person'} ADMIN access as ${label}?`)) return;
    post({ action: 'link', identityId: selected.sso_identity_id, userId: u.user_id }, `Linked ${label}`);
  }

  function create() {
    if (!selected) return;
    if (form.role === 'admin' && !window.confirm('Create an ADMIN profile for this person?')) return;
    post({ action: 'create', identityId: selected.sso_identity_id, ...form }, 'Profile created and linked');
  }

  const field = 'w-full rounded border px-2 py-1.5 text-sm';

  return (
    <section className="rounded-lg border p-4">
      <button onClick={() => setOpen(o => !o)} className="w-full text-left font-medium">
        {open ? '▾' : '▸'} Account linking (admin)
      </button>

      {open && (
        <div className="mt-4">
          {msg && (
            <div className={`mb-3 text-sm ${msg.ok ? 'text-green-700' : 'text-red-700'}`}>{msg.text}</div>
          )}

          <div className="grid gap-6 md:grid-cols-2">
            {/* Left: identities with no linked profile */}
            <div>
              <div className="mb-2 text-sm font-semibold">
                Signed in, no profile linked ({identities.length})
              </div>
              {identities.length === 0 ? (
                <div className="text-sm text-gray-500">Everyone who has signed in is linked.</div>
              ) : (
                <div className="space-y-2">
                  {identities.map(i => (
                    <button
                      key={i.sso_identity_id}
                      onClick={() => pick(i)}
                      className={`w-full rounded border p-2 text-left text-sm hover:bg-gray-50 ${
                        selected?.sso_identity_id === i.sso_identity_id ? 'bg-blue-50 border-blue-300' : ''
                      }`}
                    >
                      <div className="font-medium">{i.display_name || '(no name)'}</div>
                      <div className="text-gray-500">{i.email}</div>
                      {i.last_login_at && (
                        <div className="text-xs text-gray-400">
                          Last sign-in {new Date(i.last_login_at).toLocaleString()}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Right: link or create for the selected identity */}
            <div>
              {!selected ? (
                <div className="text-sm text-gray-500">Select a person on the left to link or create a profile.</div>
              ) : (
                <div className="space-y-5">
                  <div>
                    <div className="mb-2 text-sm font-semibold">
                      Link {selected.display_name || selected.email} to an existing profile
                    </div>
                    <input
                      className={`${field} mb-2`}
                      placeholder="Filter by name, username, role"
                      value={filter}
                      onChange={e => setFilter(e.target.value)}
                    />
                    <div className="max-h-60 space-y-1 overflow-y-auto">
                      {visibleUsers.length === 0 ? (
                        <div className="text-sm text-gray-500">No unlinked profiles match.</div>
                      ) : visibleUsers.map(u => (
                        <div key={u.user_id} className="flex items-center justify-between rounded border p-2 text-sm">
                          <div>
                            <div className="font-medium">
                              {fullName(u)} <span className="capitalize text-gray-500">· {u.role}</span>
                              {isSuggested(u) && (
                                <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800">suggested</span>
                              )}
                            </div>
                            <div className="text-xs text-gray-400">{u.username}{u.email ? ` · ${u.email}` : ''}</div>
                          </div>
                          <button
                            disabled={busy}
                            onClick={() => link(u)}
                            className="rounded border px-2 py-1 hover:bg-gray-50 disabled:opacity-50"
                          >
                            Link
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 text-sm font-semibold">Or create a new profile</div>
                    <div className="grid grid-cols-2 gap-2">
                      <input className={field} placeholder="First name" value={form.first_name}
                        onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} />
                      <input className={field} placeholder="Last name" value={form.last_name}
                        onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} />
                      <input className={field} placeholder="Username" value={form.username}
                        onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
                      <select className={field} value={form.role}
                        onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                        <option value="trainee">Trainee</option>
                        <option value="attending">Attending</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                    <button
                      disabled={busy}
                      onClick={create}
                      className="mt-2 rounded border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
                    >
                      Create and link
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}