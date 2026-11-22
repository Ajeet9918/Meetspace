import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { api } from '../lib/api.js';
import Shell from '../components/Shell.jsx';
import Field from '../components/Field.jsx';
import FormError from '../components/FormError.jsx';
import CopyButton from '../components/CopyButton.jsx';

const EXPIRY = [['never', 'Never'], ['1', 'In 1 hour'], ['24', 'In 24 hours'], ['168', 'In 7 days']];
const INVITE_RE = /([A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22})/;

export default function Dashboard() {
  const { user, logout, logoutAll } = useAuth();
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', passcode: '', expiry: 'never' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState('');

  const load = useCallback(() => api.meetings.list().then(setMeetings).catch(() => setMeetings([])), []);
  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function create(e) {
    e.preventDefault();
    setCreating(true);
    setError('');
    setFieldErrors({});
    try {
      const m = await api.meetings.create({
        title: form.title.trim() || undefined,
        passcode: form.passcode || undefined,
        inviteExpiresInHours: form.expiry === 'never' ? null : Number(form.expiry),
      });
      navigate(`/room/${m.roomId}`);
    } catch (err) {
      if (err.code === 'VALIDATION' && err.details?.length) setFieldErrors(Object.fromEntries(err.details.map((d) => [d.field, d.message])));
      else setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  function joinByLink(e) {
    e.preventDefault();
    const match = link.match(INVITE_RE);
    if (!match) return setLinkError('That doesn’t look like a MeetSpace invite link.');
    return navigate(`/m/${match[1]}`);
  }

  async function end(m) {
    if (!window.confirm(`End “${m.title || 'Untitled meeting'}” for everyone?`)) return;
    await api.meetings.end(m.roomId).catch(() => {});
    load();
  }

  return (
    <Shell
      right={
        <>
          <span className="hidden text-sm text-ink-soft sm:inline">{user.displayName}</span>
          <button onClick={logout} className="btn-quiet">Log out</button>
        </>
      }
    >
      <main className="mx-auto max-w-5xl px-6 pb-24 pt-14">
        <h1 className="text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-6xl">Meetings</h1>

        <div className="mt-8 flex max-w-2xl flex-col gap-3 sm:flex-row">
          <button onClick={() => setShowForm((v) => !v)} aria-expanded={showForm} className="btn sm:shrink-0">New meeting</button>
          <form onSubmit={joinByLink} className="flex flex-1 gap-2">
            <input
              aria-label="Invite link"
              placeholder="Paste an invite link"
              value={link}
              onChange={(e) => { setLink(e.target.value); setLinkError(''); }}
              className="h-11 min-w-0 flex-1 rounded border border-edge bg-surface px-3 hover:border-ink"
            />
            <button className="btn-outline">Join</button>
          </form>
        </div>
        {linkError && <p role="alert" className="mt-3 text-sm text-danger">{linkError}</p>}

        {showForm && (
          <form onSubmit={create} className="mt-8 max-w-md space-y-5 border-t border-rule pt-8" noValidate>
            <h2 className="text-xl font-semibold tracking-tight">New meeting</h2>
            <FormError>{error}</FormError>
            <Field label="Title (optional)" maxLength={100} value={form.title} onChange={set('title')} error={fieldErrors.title} />
            <Field label="Passcode (optional)" type="password" autoComplete="new-password" maxLength={32} value={form.passcode} onChange={set('passcode')} error={fieldErrors.passcode} hint="4 to 32 characters. Guests must enter it to ask to join." />
            <div>
              <label htmlFor="expiry" className="mb-1.5 block text-sm font-medium">Invite link expires</label>
              <select id="expiry" value={form.expiry} onChange={set('expiry')} className="h-11 w-full rounded border border-edge bg-surface px-3 hover:border-ink">
                {EXPIRY.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </div>
            <button disabled={creating} className="btn w-full sm:w-auto">{creating ? 'Creating…' : 'Create meeting'}</button>
          </form>
        )}

        <section className="mt-16 border-t border-rule pt-8" aria-labelledby="hosted">
          <h2 id="hosted" className="text-xl font-semibold tracking-tight">Meetings you host</h2>
          {meetings === null && <p className="mt-2 text-sm text-ink-faint" role="status">Loading…</p>}
          {meetings?.length === 0 && <p className="mt-2 max-w-md text-ink-soft">You haven’t hosted a meeting yet. Create one to get an invite link.</p>}
          {meetings?.length > 0 && (
            <ul className="mt-4 divide-y divide-rule border-y border-rule">
              {meetings.map((m) => (
                <li key={m.roomId} className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{m.title || 'Untitled meeting'}</p>
                    <p className="text-sm text-ink-faint">
                      Created {new Date(m.createdAt).toLocaleString()}
                      {m.hasPasscode && ' · Passcode'}
                      {m.locked && ' · Locked'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/room/${m.roomId}`} className="btn btn-sm">Open</Link>
                    <CopyButton text={m.inviteLink} />
                    <button onClick={() => end(m)} className="btn-quiet text-danger hover:text-danger">End</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-12 border-t border-rule pt-8" aria-labelledby="account">
          <h2 id="account" className="text-xl font-semibold tracking-tight">Account</h2>
          <dl className="mt-4 grid max-w-md grid-cols-[6rem_1fr] gap-y-2 text-sm">
            <dt className="text-ink-faint">Name</dt>
            <dd className="break-words">{user.displayName}</dd>
            <dt className="text-ink-faint">Email</dt>
            <dd className="break-words">{user.email}</dd>
          </dl>
          <p className="mt-6 max-w-md text-sm text-ink-soft">Lost a device or used a shared computer? Logging out everywhere ends every session on your account, including this one.</p>
          <button onClick={logoutAll} className="btn-quiet mt-3 -ml-3">Log out of all devices</button>
        </section>
      </main>
    </Shell>
  );
}