import { Server } from 'socket.io';
import env from '../config/env.js';
import logger, { audit } from '../utils/logger.js';
import Meeting from '../models/Meeting.js';
import { isAllowedOrigin } from '../middleware/security.js';
import { verifyRoomToken } from '../services/roomTokens.js';
import { isBanned } from '../services/invites.js';
import { turnCredentials } from '../services/turn.js';
import { livekitEnabled, mediaToken, muteInMedia, removeFromMedia, closeMediaRoom } from '../services/livekit.js';
import { rooms, getOrCreateRoom, admittedCount, listByStatus, publicParticipant, wasAdmitted } from './roomState.js';
import { consume, LIMITS } from './limits.js';
import * as S from './schemas.js';

export { wasAdmitted };

let io = null;

class EventError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const touch = (roomId) => Meeting.updateOne({ roomId }, { $set: { lastActivityAt: new Date() } }).catch(() => { });

export function initRealtime(httpServer) {
  io = new Server(httpServer, {
    path: '/socket.io',
    serveClient: false,
    transports: ['websocket'], // no long-polling fallback: smaller attack surface, no sticky-session need
    maxHttpBufferSize: 64 * 1024, // largest legitimate message is an SDP (~20 KB)
    connectTimeout: 10_000,
    allowRequest: (req, cb) => cb(null, Boolean(req.headers.origin) && isAllowedOrigin(req.headers.origin)),
  });
  io.use(authenticate);
  io.on('connection', onConnection);
  return io;
}

export const closeRealtime = () => new Promise((resolve) => (io ? io.close(resolve) : resolve()));
function authenticate(socket, next) {
  const token = socket.handshake.auth?.token;
  if (typeof token !== 'string' || token.length > 2000) return next(new Error('UNAUTHENTICATED'));
  try {
    const c = verifyRoomToken(token);
    socket.data.claims = { pid: c.sub, rid: c.rid, role: c.role, uid: c.uid, did: c.did, name: c.name };
    return next();
  } catch {
    return next(new Error('UNAUTHENTICATED'));
  }
}
function whoami(socket) {
  const { rid, pid } = socket.data.claims;
  const room = rooms.get(rid);
  const p = room?.participants.get(pid);
  return room && p && p.socketId === socket.id ? { room, p } : null;
}
function requireAdmitted(socket) {
  const me = whoami(socket);
  if (!me || me.p.status !== 'admitted') throw new EventError('FORBIDDEN');
  return me;
}
function requireHost(socket) {
  const me = requireAdmitted(socket);
  if (me.p.role !== 'host') throw new EventError('FORBIDDEN');
  return me;
}

function strike(socket) {
  socket.data.strikes = (socket.data.strikes ?? 0) + 1;
  if (socket.data.strikes >= 10) {
    audit('socket_abuse_disconnect', { roomId: socket.data.claims?.rid, pid: socket.data.claims?.pid });
    socket.disconnect(true);
  }
}

function handle(socket, event, schema, limit, fn) {
  socket.on(event, async (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => { };
    try {
      if (!consume(socket, limit.name, limit)) { strike(socket); return reply({ ok: false, code: 'RATE_LIMITED' }); }
      const parsed = schema.safeParse(payload);
      if (!parsed.success) { strike(socket); return reply({ ok: false, code: 'VALIDATION' }); }
      const result = await fn(parsed.data);
      return reply({ ok: true, ...(result || {}) });
    } catch (err) {
      if (err instanceof EventError) {
        if (err.code === 'FORBIDDEN') strike(socket);
        return reply({ ok: false, code: err.code });
      }
      logger.error({ event, err: { message: err.message } }, 'socket handler error'); // never log the payload
      return reply({ ok: false, code: 'INTERNAL' });
    }
  });
}

// ---------------------------------------------------------------- room operations
const sockOf = (p) => io.sockets.sockets.get(p.socketId);

const snapshot = (room, me) => ({
  roomId: room.roomId,
  title: room.title,
  locked: room.locked,
  maxParticipants: room.maxParticipants,
  you: publicParticipant(me),
  participants: listByStatus(room, 'admitted').map(publicParticipant),
});

function broadcastWaiting(room) {
  io.to(`h:${room.roomId}`).emit('waiting:list', { list: listByStatus(room, 'waiting').map((p) => ({ id: p.pid, name: p.name })) });
}

function admit(room, p) {
  const socket = sockOf(p);
  if (!socket) return;
  p.status = 'admitted';
  room.admittedDevices.add(p.deviceId);
  socket.join(`r:${room.roomId}`);
  if (p.role === 'host') socket.join(`h:${room.roomId}`);
  socket.emit('room:state', snapshot(room, p));
  socket.to(`r:${room.roomId}`).emit('room:joined', publicParticipant(p));
  broadcastWaiting(room);
  audit('room_join', { roomId: room.roomId, pid: p.pid, role: p.role });
  touch(room.roomId);
}

function dropIfEmpty(room) {
  if (room.participants.size === 0) rooms.delete(room.roomId);
}

function reject(socket, code) {
  socket.emit('join:rejected', { code });
  socket.disconnect(true);
}

/** Ends a live room: tells everyone, disconnects everyone, forgets the state. */
export function terminateRoom(roomId, event = 'room:ended') {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const p of room.participants.values()) {
    const s = sockOf(p);
    if (s) { s.emit(event); setImmediate(() => s.disconnect(true)); }
  }
  rooms.delete(roomId);
}

function onConnection(socket) {
  registerHandlers(socket);
  admitOrWait(socket).catch((err) => {
    logger.error({ err: { message: err.message } }, 'join failed');
    reject(socket, 'ERROR');
  });
}

async function admitOrWait(socket) {
  const { rid, pid, did, uid, name, role: claimedRole } = socket.data.claims;

  const meeting = await Meeting.findOne({ roomId: rid }).select('+bannedDevices +bannedUsers');
  if (!meeting || meeting.status !== 'active') return reject(socket, 'ENDED');

  // Host status comes from the database. A token that merely CLAIMS host is not enough.
  const isHost = claimedRole === 'host' && Boolean(uid) && String(meeting.host) === String(uid);
  if (claimedRole === 'host' && !isHost) return reject(socket, 'DENIED');
  if (!isHost && isBanned(meeting, did, uid)) return reject(socket, 'DENIED');

  const room = getOrCreateRoom(meeting);

  // One live socket per participant: a reconnect or second tab replaces the old connection.
  const prev = room.participants.get(pid);
  if (prev && prev.socketId !== socket.id) sockOf(prev)?.disconnect(true);

  const p = { pid, socketId: socket.id, name, role: isHost ? 'host' : 'guest', userId: uid, deviceId: did, status: 'waiting' };
  room.participants.set(pid, p);

  if (isHost) return admit(room, p);

  if (room.admittedDevices.has(did) && admittedCount(room) < room.maxParticipants) return admit(room, p);

  if (room.locked && !room.admittedDevices.has(did)) { room.participants.delete(pid); dropIfEmpty(room); return reject(socket, 'LOCKED'); }
  if (listByStatus(room, 'waiting').length > env.MAX_WAITING) { room.participants.delete(pid); dropIfEmpty(room); return reject(socket, 'BUSY'); }

  socket.emit('waiting:status', { status: 'waiting' });
  broadcastWaiting(room);
  audit('room_waiting', { roomId: rid, pid });
}

function registerHandlers(socket) {
  handle(socket, 'waiting:admit', S.idPayload, LIMITS.control, ({ id }) => {
    const { room } = requireHost(socket);
    const target = room.participants.get(id);
    if (!target || target.status !== 'waiting') throw new EventError('NOT_FOUND');
    if (admittedCount(room) >= room.maxParticipants) throw new EventError('FULL');
    admit(room, target);
  });

  handle(socket, 'waiting:deny', S.idPayload, LIMITS.control, ({ id }) => {
    const { room } = requireHost(socket);
    const target = room.participants.get(id);
    if (!target || target.status !== 'waiting') throw new EventError('NOT_FOUND');
    room.participants.delete(id);
    const s = sockOf(target);
    if (s) { s.emit('waiting:denied'); s.disconnect(true); }
    broadcastWaiting(room);
    audit('room_deny', { roomId: room.roomId, pid: id });
  });

  handle(socket, 'room:lock', S.lockPayload, LIMITS.control, async ({ locked }) => {
    const { room } = requireHost(socket);
    await Meeting.updateOne({ roomId: room.roomId }, { $set: { locked } });
    room.locked = locked;
    io.to(`r:${room.roomId}`).emit('room:locked', { locked });
    audit('room_lock', { roomId: room.roomId, locked });
  });

  handle(socket, 'room:remove', S.idPayload, LIMITS.control, async ({ id }) => {
    const { room, p } = requireHost(socket);
    const target = room.participants.get(id);
    if (!target || target.role === 'host' || target.pid === p.pid) throw new EventError('FORBIDDEN');
    // Ban first, so a fast reconnect cannot slip in between.
    const add = { bannedDevices: target.deviceId };
    if (target.userId) add.bannedUsers = target.userId;
    await Meeting.updateOne({ roomId: room.roomId }, { $addToSet: add });
    room.participants.delete(id);
    room.admittedDevices.delete(target.deviceId);
    const s = sockOf(target);
    if (s) { s.emit('removed'); s.disconnect(true); }
    removeFromMedia(room.roomId, id); // also kick them off the media server
    io.to(`r:${room.roomId}`).emit('room:left', { id });
    broadcastWaiting(room);
    audit('room_remove', { roomId: room.roomId, pid: id });
  });

  handle(socket, 'room:end', S.empty, LIMITS.control, async () => {
    const { room } = requireHost(socket);
    await endMeeting(room.roomId);
    audit('room_end', { roomId: room.roomId });
  });
  // Chat. The server stamps sender and time; text is relayed to the room and never stored or logged.
  handle(socket, 'chat:send', S.chatPayload, LIMITS.chat, ({ text }) => {
    const { room, p } = requireAdmitted(socket);
    room.seq = (room.seq ?? 0) + 1;
    io.to(`r:${room.roomId}`).emit('chat:message', { id: String(room.seq), from: p.pid, name: p.name, text, at: Date.now() });
  });

  // Lets everyone see who is muted.
  handle(socket, 'media:state', S.mediaPayload, LIMITS.state, ({ mic }) => {
    const { room, p } = requireAdmitted(socket);
    p.mic = mic;
    socket.to(`r:${room.roomId}`).emit('peer:media', { id: p.pid, mic });
  });
  handle(socket, 'participant:mute', S.idPayload, LIMITS.control, ({ id }) => {
    const { room, p } = requireHost(socket);
    const target = room.participants.get(id);
    if (!target || target.status !== 'admitted' || target.pid === p.pid) throw new EventError('NOT_FOUND');
    sockOf(target)?.emit('mute:request'); // lets the person's screen explain what happened
    muteInMedia(room.roomId, id); // the media server enforces it
    audit('room_mute', { roomId: room.roomId, pid: id });
  });

  handle(socket, 'room:mute-all', S.empty, LIMITS.control, () => {
    const { room, p } = requireHost(socket);
    for (const t of listByStatus(room, 'admitted')) {
      if (t.pid === p.pid) continue;
      sockOf(t)?.emit('mute:request');
      muteInMedia(room.roomId, t.pid);
    }
    audit('room_mute_all', { roomId: room.roomId });
  });
  // Media access. Only admitted participants can obtain a token for the media server.
  handle(socket, 'media:token', S.empty, LIMITS.turn, async () => {
    const { room, p } = requireAdmitted(socket);
    if (!livekitEnabled) throw new EventError('MEDIA_NOT_CONFIGURED');
    return { url: env.LIVEKIT_URL, token: await mediaToken(p, room) };
  });

  // For large meetings: admit everyone waiting, up to the room limit.
  handle(socket, 'waiting:admit-all', S.empty, LIMITS.control, () => {
    const { room } = requireHost(socket);
    let admitted = 0;
    for (const w of listByStatus(room, 'waiting')) {
      if (admittedCount(room) >= room.maxParticipants) break;
      admit(room, w);
      admitted += 1;
    }
    return { admitted, remaining: listByStatus(room, 'waiting').length };
  });
  //time limited turn credentials for WebRTC. The server never sees the media, so this is safe to give to any participant.
  handle(socket, 'turn:credentials', S.empty, LIMITS.turn, () => {
    const { p } = requireAdmitted(socket);
    return turnCredentials(p.pid);
  });

  // Signaling relay. Sender and recipient must both be ADMITTED in the same room; the server
  // sets "from", so a participant cannot impersonate another.
  handle(socket, 'signal', S.signalPayload, LIMITS.signal, ({ to, kind, data }) => {
    const { room, p } = requireAdmitted(socket);
    const target = room.participants.get(to);
    if (!target || target.status !== 'admitted' || target.pid === p.pid) throw new EventError('FORBIDDEN');
    io.to(target.socketId).emit('signal', { from: p.pid, kind, data });
  });

  socket.on('disconnect', () => {
    const { rid, pid } = socket.data.claims || {};
    const room = rooms.get(rid);
    const p = room?.participants.get(pid);
    if (!room || !p || p.socketId !== socket.id) return; // already replaced or removed
    room.participants.delete(pid);
    if (p.status === 'admitted') {
      io.to(`r:${rid}`).emit('room:left', { id: pid });
      audit('room_leave', { roomId: rid, pid });
    } else {
      broadcastWaiting(room);
    }
    dropIfEmpty(room);
    touch(rid);
  });
}

/** Marks a meeting ended in the database and disconnects everyone. Used by the socket and REST paths. */
export async function endMeeting(roomId) {
  const now = new Date();
  await Meeting.updateOne(
    { roomId, status: 'active' },
    { $set: { status: 'ended', endedAt: now, purgeAt: new Date(now.getTime() + env.ENDED_RETENTION_HOURS * 3_600_000) } }
  );
  terminateRoom(roomId, 'room:ended');
  closedMediaRoom(roomId);
}

export const liveRoomIds = () => [...rooms.keys()];