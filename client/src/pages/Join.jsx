import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Shell from '../components/Shell.jsx';
import Field from '../components/Field.jsx';
import FormError from '../components/FormError.jsx';
import RoomView from '../components/RoomView.jsx';
import { useAuth } from '../lib/AuthContext.jsx';
import { api } from '../lib/api.js';
import { useRoom } from '../lib/useRoom.js';
import { useMedia } from '../lib/useMedia.js';

function GuestRoom({ token, onLeave }) {
  const room = useRoom(token);
  const media = useMedia(room);
  return <RoomView room={room} media={media} onLeave={onLeave} exitAction={<button onClick={onLeave} className="btn">Back to the join page</button>} />;
}

export default function Join() {
  const { invite } = useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState(null);
  const [problem, setProblem] = useState('');
  const [name, setName] = useState('');
  const [passcode, setPasscode] = useState('');
  const [nameError, setNameError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState(null);

  useEffect(() => {
    if (loading) return undefined;
    let alive = true;
    api.meetings.lookup(invite)
      .then((d) => {
        if (!alive) return;
        if (d.isHost) navigate(`/room/${d.roomId}`, { replace: true });
        else setInfo(d);
      })
      .catch((err) => alive && setProblem(err.message));
    return () => { alive = false; };
  }, [invite, loading, navigate]);

  useEffect(() => { if (user) setName((n) => n || user.displayName); }, [user]);

  const right = user ? <span className="text-sm text-ink-soft">{user.displayName}</span> : <Link to="/login" className="btn-quiet">Log in</Link>;

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNameError('');
    try {
      const res = await api.meetings.join({ invite, displayName: name, passcode: info.requiresPasscode ? passcode : undefined });
      setToken(res.token);
    } catch (err) {
      if (err.code === 'VALIDATION' && err.details?.length) setNameError(err.details.find((d) => d.field === 'displayName')?.message || 'Check your name.');
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const leave = () => { setToken(null); setPasscode(''); };

  if (token) return <GuestRoom token={token} onLeave={leave} />;

  if (problem) {
    return (
      <Shell right={right}>
        <main className="mx-auto max-w-5xl px-6 pt-20">
          <h1 className="max-w-lg text-4xl font-semibold leading-[1.05] tracking-[-0.03em] sm:text-5xl">This invite doesn’t work</h1>
          <p className="mt-4 max-w-md text-lg text-ink-soft">{problem} Ask the host for a new link.</p>
        </main>
      </Shell>
    );
  }

  if (!info) return <Shell right={right}><p className="px-6 pt-20 text-sm text-ink-faint" role="status">Checking your invite…</p></Shell>;

  return (
    <Shell right={right}>
      <main className="mx-auto max-w-5xl px-6 pb-20 pt-14 sm:pt-24">
        <div className="max-w-md">
          <p className="text-sm text-ink-faint">Hosted by {info.hostName}</p>
          <h1 className="mt-2 text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-6xl">{info.title || 'Join the meeting'}</h1>
          <p className="mt-4 text-lg leading-snug text-ink-soft">The host will let you in from the waiting room.</p>

          <form onSubmit={onSubmit} className="mt-10 space-y-5" noValidate>
            <FormError>{info.locked ? 'The host has locked this meeting.' : error}</FormError>
            <Field label="Your name" autoComplete="name" required maxLength={50} value={name} onChange={(e) => setName(e.target.value)} error={nameError} hint="Shown to everyone in the meeting." />
            {info.requiresPasscode && (
              <Field label="Meeting passcode" type="password" autoComplete="off" required maxLength={32} value={passcode} onChange={(e) => setPasscode(e.target.value)} />
            )}
            <button disabled={busy || info.locked || !name.trim()} className="btn w-full sm:w-auto">{busy ? 'Joining…' : 'Ask to join'}</button>
          </form>
        </div>
      </main>
    </Shell>
  );
}