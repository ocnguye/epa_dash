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

const ROLE_HELP: Record<string, string> = {
  trainee: 'Can see their own EPA scores and reports.',
  attending: 'Can see the trainees and reports they work with.',
  admin: 'Can see program-wide data and use this tool. Grant with care.',
};

export default function AdminLinkingPanel() {
  const router = useRouter();
  const [identities, setIdentities] = useState<Ident[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<Ident | null>(null);
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
      `${who} is now connected to ${label}. They will see it the next time they sign in.`,
    );
  }

  function create() {
    if (!selected) return;
    const who = selected.display_name || selected.email || 'this person';
    if (form.role === 'admin' && !window.confirm(`Create an ADMIN profile for ${who}?`)) return;
    post(
      { action: 'create', identityId: selected.sso_identity_id, ...form },
      `A ${form.role} profile was created for ${who}. They will see it the next time they sign in.`,
    );
  }

  const input = 'w-full rounded-md border border-gray-400 bg-white px-3 py-2 text-base text-gray-900 placeholder-gray-500';
  const label = 'mb-1 block text-sm font-semibold text-gray-900';

  return (
    <div className="text-gray-900">
      {msg && (
        <div
          role="status"
          className={`mb-4 rounded-lg border p-3 text-base font-medium ${
            msg.ok
              ? 'border-green-400 bg-green-50 text-green-900'
              : 'border-red-400 bg-red-50 text-red-900'
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="grid gap-8 md:grid-cols-2">
        {/* LEFT: who is waiting */}
        <section>
          <h2 className="text-xl font-semibold text-gray-900">
            Awaiting profile setup ({identities.length})
          </h2>
          <p className="mt-1 mb-3 text-base text-gray-800">
            The following Emory users have signed in to the dashboard but do not have a user
            profile yet, so they cannot see anything. Select a person to continue.
          </p>

          {!loaded ? (
            <div className="text-base text-gray-700">Loading…</div>
          ) : identities.length === 0 ? (
            <div className="rounded-lg border border-gray-300 bg-gray-50 p-4 text-base text-gray-800">
              No one is waiting. Everyone who has signed in with Emory is connected to at least
              one profile.
            </div>
          ) : (
            <div className="space-y-2">
              {identities.map(i => {
                const active = selected?.sso_identity_id === i.sso_identity_id;
                return (
                  <button
                    key={i.sso_identity_id}
                    onClick={() => pick(i)}
                    className={`w-full rounded-lg border p-3 text-left hover:bg-blue-50 ${
                      active ? 'border-blue-600 bg-blue-50 ring-2 ring-blue-300' : 'border-gray-300 bg-white'
                    }`}
                  >
                    <div className="text-base font-semibold text-gray-900">
                      {i.display_name || '(no name provided)'}
                    </div>
                    <div className="text-base text-gray-800">{i.email}</div>
                    {i.last_login_at && (
                      <div className="text-sm text-gray-700">
                        Last signed in {new Date(i.last_login_at).toLocaleString()}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* RIGHT: what to do */}
        <section>
          {!selected ? (
            <div className="rounded-lg border border-dashed border-gray-400 p-6 text-base text-gray-800">
              <div className="font-semibold text-gray-900">Step 1: choose a person</div>
              <p className="mt-1">
                Select someone from the list on the left. You will then be able to connect them
                to an existing profile or create a new one.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="rounded-lg bg-blue-50 p-3 text-base text-blue-950">
                Setting up access for{' '}
                <strong>{selected.display_name || selected.email}</strong>
                {selected.display_name && selected.email ? ` (${selected.email})` : ''}
              </div>

              {/* Option A */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Option A: Connect to an existing profile
                </h3>
                <p className="mt-1 mb-2 text-base text-gray-800">
                  Use this if the person already has a profile in the dashboard (for example,
                  from the roster) that is not connected to an Emory sign-in. Profiles that
                  match their name or email are marked <strong>Suggested</strong>, but please
                  confirm it is really the same person before connecting.
                </p>
                <input
                  className={`${input} mb-2`}
                  placeholder="Search by name, username, or role"
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                />
                <div className="max-h-64 space-y-2 overflow-y-auto">
                  {visibleUsers.length === 0 ? (
                    <div className="text-base text-gray-800">
                      No unconnected profiles match. You can create a new one below.
                    </div>
                  ) : visibleUsers.map(u => (
                    <div
                      key={u.user_id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-gray-300 bg-white p-3"
                    >
                      <div>
                        <div className="text-base font-semibold text-gray-900">
                          {fullName(u)}{' '}
                          <span className="font-normal capitalize text-gray-800">· {u.role}</span>
                          {isSuggested(u) && (
                            <span className="ml-2 rounded bg-green-100 px-2 py-0.5 text-sm font-semibold text-green-900">
                              Suggested
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-gray-700">
                          Username: {u.username}{u.email ? ` · ${u.email}` : ''}
                        </div>
                      </div>
                      <button
                        disabled={busy}
                        onClick={() => link(u)}
                        className="rounded-md bg-blue-700 px-3 py-2 text-base font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                      >
                        Connect
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Option B */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Option B: Create a new profile
                </h3>
                <p className="mt-1 mb-3 text-base text-gray-800">
                  Use this if the person is new and has no profile yet. A profile is created
                  with the role you choose and connected to their Emory sign-in. There is no
                  separate password, because they sign in with Emory.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={label}>First name</label>
                    <input className={input} value={form.first_name}
                      onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} />
                  </div>
                  <div>
                    <label className={label}>Last name</label>
                    <input className={input} value={form.last_name}
                      onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} />
                  </div>
                  <div>
                    <label className={label}>Username</label>
                    <input className={input} value={form.username}
                      onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
                  </div>
                  <div>
                    <label className={label}>Role</label>
                    <select className={input} value={form.role}
                      onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                      <option value="trainee">Trainee</option>
                      <option value="attending">Attending</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                </div>
                <p className="mt-2 text-base text-gray-800">{ROLE_HELP[form.role]}</p>
                <button
                  disabled={busy}
                  onClick={create}
                  className="mt-3 rounded-md bg-blue-700 px-4 py-2 text-base font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                >
                  Create profile and connect
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}