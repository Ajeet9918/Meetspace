import { useCallback, useEffect, useReducer, useRef } from 'react';
import { io } from 'socket.io-client';

const initial = { phase: 'connecting', connected: false, code: null, you: null, participants: [], messages: [], muteSeq: 0, waiting: [], locked: false, maxParticipants: 6, title: '' };

const TERMINAL = new Set(['denied', 'removed', 'ended', 'rejected', 'expired']);

function reducer(s, a) {
  if (TERMINAL.has(s.phase) && a.type !== 'reset') return s; // once the server says we're out, nothing revives the session
  switch (a.type) {
    case 'connected': return { ...s, connected: a.value };
    case 'waiting': return { ...s, phase: 'waiting' };
    case 'state': return { ...s, phase: 'in', you: a.snap.you, participants: a.snap.participants, locked: a.snap.locked, maxParticipants: a.snap.maxParticipants, title: a.snap.title };
    case 'joined': return { ...s, participants: [...s.participants.filter((p) => p.id !== a.p.id), a.p] };
    case 'left': return { ...s, participants: s.participants.filter((p) => p.id !== a.id) };
    case 'waitingList': return { ...s, waiting: a.list };
    case 'chat': return { ...s, messages: [...s.messages, a.m].slice(-200) };
    case 'peerMedia': return { ...s, participants: s.participants.map((p) => (p.id === a.id ? { ...p, mic: a.mic } : p)) };
    case 'muteRequest': return { ...s, muteSeq: s.muteSeq + 1 };
    case 'locked': return { ...s, locked: a.locked };
    case 'end': return { ...s, phase: a.phase, code: a.code ?? null };
    default: return s;
  }
}
export function useRoom(token) {
  const [state, dispatch] = useReducer(reducer, initial);
  const socketRef = useRef(null);
  const signalListeners = useRef(new Set());

  useEffect(() => {
    if (!token) return undefined;
    const socket = io({ path: '/socket.io', transports: ['websocket'], auth: { token }, reconnectionAttempts: 8 });
    socketRef.current = socket;

    socket.on('connect', () => dispatch({ type: 'connected', value: true }));
    socket.on('disconnect', () => dispatch({ type: 'connected', value: false }));
    socket.on('connect_error', (err) => { if (err.message === 'UNAUTHENTICATED') dispatch({ type: 'end', phase: 'expired' }); });
    socket.on('waiting:status', () => dispatch({ type: 'waiting' }));
    socket.on('room:state', (snap) => dispatch({ type: 'state', snap }));
    socket.on('room:joined', (p) => dispatch({ type: 'joined', p }));
    socket.on('room:left', ({ id }) => dispatch({ type: 'left', id }));
    socket.on('room:locked', ({ locked }) => dispatch({ type: 'locked', locked }));
    socket.on('waiting:list', ({ list }) => dispatch({ type: 'waitingList', list }));
    socket.on('waiting:denied', () => dispatch({ type: 'end', phase: 'denied' }));
    socket.on('removed', () => dispatch({ type: 'end', phase: 'removed' }));
    socket.on('room:ended', () => dispatch({ type: 'end', phase: 'ended' }));
    socket.on('chat:message', (m) => dispatch({ type: 'chat', m }));
    socket.on('peer:media', ({ id, mic }) => dispatch({ type: 'peerMedia', id, mic }));
    socket.on('mute:request', () => dispatch({ type: 'muteRequest' }));
    socket.on('signal', (msg) => signalListeners.current.forEach((fn) => fn(msg)));
    socket.on('join:rejected', ({ code }) => dispatch({ type: 'end', phase: 'rejected', code }));

    return () => { socket.removeAllListeners(); socket.disconnect(); socketRef.current = null; };
  }, [token]);

  const emit = useCallback(
    (event, payload) =>
      new Promise((resolve) => {
        const s = socketRef.current;
        if (!s) return resolve({ ok: false, code: 'NOT_CONNECTED' });
        s.timeout(5000).emit(event, payload, (err, res) => resolve(err ? { ok: false, code: 'TIMEOUT' } : res));
      }),
    []
  );

  const onSignal = useCallback((fn) => {
    signalListeners.current.add(fn);
    return () => signalListeners.current.delete(fn);
  }, []);

  return { ...state, emit, onSignal };
}