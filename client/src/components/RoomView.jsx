import { useState } from 'react';
import Shell from './Shell.jsx';
import CopyButton from './CopyButton.jsx';
import VideoGrid from './VideoGrid.jsx';
import ChatPanel from './ChatPanel.jsx';

const NOTICES = {
    FULL: 'The meeting is full. Remove someone first.',
    NOT_FOUND: 'That person is no longer waiting.',
    FORBIDDEN: 'You can’t do that.',
    RATE_LIMITED: 'Slow down a little.',
    TIMEOUT: 'The server didn’t respond. Try again.',
};

const ENDINGS = {
    denied: ['The host didn’t let you in', 'You can ask again from the invite link.'],
    removed: ['You were removed from this meeting', 'You can’t rejoin it.'],
    ended: ['This meeting has ended', 'The host ended it for everyone.'],
    expired: ['Your session expired', 'Open the invite link again to rejoin.'],
};
const REJECTIONS = {
    LOCKED: 'The host has locked this meeting.',
    DENIED: 'You can’t join this meeting.',
    ENDED: 'This meeting has ended.',
    BUSY: 'The waiting room is full. Try again in a moment.',
};

function Message({ title, body, action }) {
    return (
        <Shell>
            <main className="mx-auto max-w-5xl px-6 pt-20">
                <h1 className="max-w-lg text-4xl font-semibold leading-[1.05] tracking-[-0.03em] sm:text-5xl">{title}</h1>
                {body && <p className="mt-4 max-w-md text-lg text-ink-soft">{body}</p>}
                {action && <div className="mt-8">{action}</div>}
            </main>
        </Shell>
    );
}

export default function RoomView({ room, media, meeting, onLeave, onRegenerate, leaveLabel = 'Leave', exitAction }) {
    const [notice, setNotice] = useState('');
    const isHost = room.you?.role === 'host';

    async function run(event, payload, confirmText) {
        if (confirmText && !window.confirm(confirmText)) return;
        setNotice('');
        const res = await room.emit(event, payload);
        if (!res.ok) setNotice(NOTICES[res.code] || 'Something went wrong.');
    }

    if (room.phase === 'connecting') return <Message title="Connecting…" />;
    if (ENDINGS[room.phase]) return <Message title={ENDINGS[room.phase][0]} body={ENDINGS[room.phase][1]} action={exitAction} />;
    if (room.phase === 'rejected') return <Message title="You can’t join right now" body={REJECTIONS[room.code] || 'Something went wrong. Try again.'} action={exitAction} />;

    if (room.phase === 'waiting') {
        return (
            <Shell right={<button onClick={onLeave} className="btn-quiet">Leave</button>}>
                <main className="mx-auto max-w-5xl px-6 pt-20">
                    <p className="text-sm text-ink-faint">Waiting room</p>
                    <h1 className="mt-2 max-w-lg text-4xl font-semibold leading-[1.05] tracking-[-0.03em] sm:text-5xl">Waiting for the host to let you in</h1>
                    <p className="mt-4 max-w-md text-lg text-ink-soft">Keep this page open. You’ll enter the meeting as soon as you’re admitted.</p>
                </main>
            </Shell>
        );
    }

    const count = room.participants.length;
    return (
        <Shell right={<button onClick={onLeave} className="btn-quiet">{leaveLabel}</button>}>
            <main className="mx-auto max-w-5xl px-6 pb-24 pt-10">
                <p className="text-sm text-ink-faint">
                    {room.locked ? 'Locked' : 'Open'} · {count} of {room.maxParticipants} in the room
                    {!room.connected && ' · Reconnecting…'}
                </p>
                <h1 className="mt-2 text-4xl font-semibold leading-[1.05] tracking-[-0.03em] sm:text-5xl">{room.title || 'Meeting'}</h1>

                {notice && <p role="alert" className="mt-6 border-l-2 border-danger pl-3 text-sm text-danger">{notice}</p>}

                {media && <VideoGrid room={room} media={media} />}

                <ChatPanel room={room} />

                <div className={`mt-10 grid gap-12 ${isHost ? 'lg:grid-cols-[1fr_20rem]' : ''}`}>
                    <section aria-labelledby="people">
                        <h2 id="people" className="text-xl font-semibold tracking-tight">In the meeting</h2>
                        <ul className="mt-4 divide-y divide-rule border-y border-rule">
                            {room.participants.map((p) => (
                                <li key={p.id} className="flex items-center justify-between gap-4 py-3">
                                    {/* Names are untrusted input; React renders them as text, never as HTML. */}
                                    <span className="min-w-0 truncate">
                                        {p.name}
                                        {p.id === room.you.id && <span className="ml-2 text-sm text-ink-faint">You</span>}
                                        {p.role === 'host' && <span className="ml-2 text-sm text-ink-faint">Host</span>}
                                        {p.mic === false && <span className="ml-2 text-sm text-ink-faint">Muted</span>}
                                    </span>
                                    {isHost && p.role !== 'host' && (
                                        <span className="flex shrink-0 gap-1">
                                            {p.mic !== false && <button onClick={() => run('participant:mute', { id: p.id })} className="btn-quiet">Mute</button>}
                                            <button onClick={() => run('room:remove', { id: p.id }, `Remove ${p.name}? They won’t be able to rejoin this meeting.`)} className="btn-quiet text-danger hover:text-danger">Remove</button>
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </section>

                    {isHost && (
                        <aside className="space-y-10">
                            <section aria-labelledby="waiting">
                                <h2 id="waiting" className="text-xl font-semibold tracking-tight">Waiting to join{room.waiting.length > 0 && ` (${room.waiting.length})`}</h2>
                                {room.waiting.length > 1 && <button onClick={() => run('waiting:admit-all')} className="btn btn-sm mt-3">Admit all ({room.waiting.length})</button>}
                                {room.waiting.length === 0 ? (
                                    <p className="mt-3 text-sm text-ink-soft">No one is waiting.</p>
                                ) : (
                                    <ul className="mt-4 divide-y divide-rule border-y border-rule">
                                        {room.waiting.map((w) => (
                                            <li key={w.id} className="py-3">
                                                <p className="truncate">{w.name}</p>
                                                <div className="mt-2 flex gap-2">
                                                    <button onClick={() => run('waiting:admit', { id: w.id })} className="btn btn-sm">Admit</button>
                                                    <button onClick={() => run('waiting:deny', { id: w.id })} className="btn-outline btn-sm">Deny</button>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </section>

                            <section aria-labelledby="controls">
                                <h2 id="controls" className="text-xl font-semibold tracking-tight">Meeting controls</h2>
                                <div className="mt-4 flex flex-col items-start gap-2">
                                    {meeting && <CopyButton text={meeting.inviteLink} />}
                                    <button onClick={() => run('room:lock', { locked: !room.locked })} className="btn-outline btn-sm">{room.locked ? 'Unlock meeting' : 'Lock meeting'}</button>
                                    {onRegenerate && (
                                        <button onClick={() => window.confirm('Create a new invite link? The current link will stop working immediately.') && onRegenerate()} className="btn-outline btn-sm">New invite link</button>
                                    )}
                                    <button onClick={() => run('room:mute-all')} className="btn-outline btn-sm">Mute everyone</button>
                                    <button onClick={() => run('room:end', undefined, 'End this meeting for everyone?')} className="btn-quiet -ml-3 text-danger hover:text-danger">End meeting for everyone</button>
                                </div>
                                {meeting && (
                                    <p className="mt-4 text-sm text-ink-faint">
                                        {meeting.hasPasscode ? 'Passcode required.' : 'No passcode.'}{' '}
                                        {meeting.inviteExpiresAt ? `Link expires ${new Date(meeting.inviteExpiresAt).toLocaleString()}.` : 'Link does not expire.'}
                                    </p>
                                )}
                            </section>
                        </aside>
                    )}
                </div>
            </main>
        </Shell>
    );
}