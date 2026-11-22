import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Shell from '../components/Shell.jsx';
import RoomView from '../components/RoomView.jsx';
import { api } from '../lib/api.js';
import { useRoom } from '../lib/useRoom.js';
import { useMedia } from '../lib/useMedia.js';

function HostSession({ roomId, token, initialMeeting }) {
  const navigate = useNavigate();
  const room = useRoom(token);
  const media = useMedia(room);
  const [meeting, setMeeting] = useState(initialMeeting);
  const regenerate = async () => setMeeting(await api.meetings.regenerate(roomId));
  return (
    <RoomView
      room={room}
      media={media}
      meeting={meeting}
      onLeave={() => navigate('/')}
      onRegenerate={regenerate}
      exitAction={<Link to="/" className="btn">Back to meetings</Link>}
    />
  );
}

export default function HostRoom() {
  const { roomId } = useParams();
  const [boot, setBoot] = useState({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    api.meetings.enter(roomId)
      .then((d) => alive && setBoot({ status: 'ready', token: d.token, meeting: d.meeting }))
      .catch((err) => alive && setBoot({ status: 'error', message: err.status === 404 ? 'We couldn’t find that meeting.' : err.message }));
    return () => { alive = false; };
  }, [roomId]);

  if (boot.status === 'loading') return <Shell><p className="px-6 pt-20 text-sm text-ink-faint" role="status">Opening your meeting…</p></Shell>;
  if (boot.status === 'error') {
    return (
      <Shell>
        <main className="mx-auto max-w-5xl px-6 pt-20">
          <h1 className="max-w-lg text-4xl font-semibold leading-[1.05] tracking-[-0.03em] sm:text-5xl">{boot.message}</h1>
          <Link to="/" className="btn mt-8">Back to meetings</Link>
        </main>
      </Shell>
    );
  }
  return <HostSession roomId={roomId} token={boot.token} initialMeeting={boot.meeting} />;
}