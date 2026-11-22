import { useEffect, useRef, useState } from 'react';

export default function ChatPanel({ room }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const list = useRef(null);

  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [room.messages.length]);

  async function send(e) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    const res = await room.emit('chat:send', { text: t });
    if (res.ok) return setError('');
    setText(t); // keep what they typed
    return setError(res.code === 'RATE_LIMITED' ? 'You’re sending messages too fast.' : 'Your message wasn’t sent.');
  }

  return (
    <section aria-labelledby="chat" className="mt-10 max-w-2xl">
      <h2 id="chat" className="text-xl font-semibold tracking-tight">Chat</h2>
      <ol ref={list} role="log" aria-live="polite" className="mt-4 h-64 space-y-3 overflow-y-auto border-y border-rule py-3">
        {room.messages.length === 0 && <li className="text-sm text-ink-faint">No messages yet. Messages aren’t saved, so people who join later won’t see earlier ones.</li>}
        {room.messages.map((m) => (
          <li key={m.id}>
            {/* Chat text is untrusted. React renders it as plain text, and links are never made clickable. */}
            <span className="text-sm text-ink-faint">
              {m.name}{m.from === room.you.id && ' (you)'} · {new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <p className="whitespace-pre-wrap break-words">{m.text}</p>
          </li>
        ))}
      </ol>
      <form onSubmit={send} className="mt-3 flex gap-2">
        <input
          aria-label="Message"
          placeholder="Write a message"
          maxLength={500}
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="h-11 min-w-0 flex-1 rounded border border-edge bg-surface px-3 hover:border-ink"
        />
        <button className="btn-outline">Send</button>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </section>
  );
}