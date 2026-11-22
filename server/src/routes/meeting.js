import { Router } from 'express';
import { z } from 'zod';
import env from '../config/env.js';
import Meeting from '../models/Meeting.js';
import User from '../models/User.js';
import { asyncHandler, AppError } from '../utils/errors.js';
import { audit } from '../utils/logger.js';
import { displayNameSchema, titleSchema } from '../utils/validators.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { createLimiter, lookupLimiter, joinLimiter, joinFailLimiter } from '../middleware/rateLimit.js';
import { hashPassword, verifyPassword } from '../services/password.js';
import { newRoomId, newParticipantId, isRoomId, makeInvite, resolveInvite, isBanned } from '../services/invites.js';
import { signRoomToken } from '../services/roomTokens.js';
import { getDeviceId } from '../services/device.js';
import { wasAdmitted, endMeeting } from '../realtime/index.js';

const router = Router();
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// ---------------------------------------------------------------- schemas
const hours = z.number().int().min(1).max(24 * 30);
const createSchema = z.strictObject({
  title: titleSchema.optional(),
  passcode: z.string().min(4, 'Passcode must be at least 4 characters').max(32, 'Passcode must be 32 characters or fewer').optional(),
  maxParticipants: z.number().int().min(2).max(6).optional(),
  inviteExpiresInHours: hours.nullable().optional(),
});
const regenerateSchema = z.strictObject({ inviteExpiresInHours: hours.nullable().optional() });
const inviteField = z.string().min(10).max(64);
const lookupSchema = z.strictObject({ invite: inviteField });
const joinSchema = z.strictObject({ invite: inviteField, displayName: displayNameSchema, passcode: z.string().max(32).optional() });

// ---------------------------------------------------------------- helpers
const INVALID_INVITE = () => new AppError(404, 'INVALID_INVITE', 'This invite link isn’t valid or has expired.');
const ENDED = () => new AppError(410, 'MEETING_ENDED', 'This meeting has ended.');
const expiryFrom = (h) => (h == null ? null : new Date(Date.now() + h * 3_600_000));
const inviteLink = (m) => `${env.CLIENT_ORIGINS[0]}/m/${makeInvite(m)}`;

const hostView = (m) => ({
  roomId: m.roomId,
  title: m.title,
  status: m.status,
  locked: m.locked,
  hasPasscode: m.hasPasscode,
  maxParticipants: m.maxParticipants,
  inviteLink: inviteLink(m),
  inviteExpiresAt: m.inviteExpiresAt,
  createdAt: m.createdAt,
});

/** Host-only lookup. A meeting that exists but belongs to someone else is indistinguishable from one that does not exist. */
async function loadOwned(req) {
  if (!isRoomId(req.params.roomId)) throw new AppError(404, 'NOT_FOUND', 'Meeting not found');
  const m = await Meeting.findOne({ roomId: req.params.roomId, host: req.userId });
  if (!m) throw new AppError(404, 'NOT_FOUND', 'Meeting not found');
  return m;
}

async function resolveOrThrow(invite) {
  const found = await resolveInvite(invite);
  if (!found) throw INVALID_INVITE();
  if (found.ended) throw ENDED();
  return found.meeting;
}

// ---------------------------------------------------------------- host: create / list / manage
router.post('/', createLimiter, requireAuth, validateBody(createSchema), asyncHandler(async (req, res) => {
  const { title, passcode, maxParticipants, inviteExpiresInHours } = req.body;
  if ((await Meeting.countDocuments({ host: req.userId, status: 'active' })) >= 20) {
    throw new AppError(429, 'TOO_MANY_MEETINGS', 'You have too many active meetings. End one first.');
  }
  const meeting = await Meeting.create({
    roomId: newRoomId(),
    host: req.userId,
    title: title || '',
    maxParticipants: maxParticipants ?? 6,
    inviteExpiresAt: expiryFrom(inviteExpiresInHours),
    ...(passcode ? { hasPasscode: true, passcodeHash: await hashPassword(passcode) } : {}),
  });
  audit('meeting_created', { roomId: meeting.roomId, userId: req.userId });
  res.status(201).json({ meeting: hostView(meeting) });
}));

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const list = await Meeting.find({ host: req.userId, status: 'active' }).sort({ createdAt: -1 }).limit(20);
  res.json({ meetings: list.map(hostView) });
}));

router.get('/:roomId', requireAuth, asyncHandler(async (req, res) => {
  res.json({ meeting: hostView(await loadOwned(req)) });
}));

// Host enters their own meeting. Role is decided here from the database, never from the client.
router.post('/:roomId/enter', requireAuth, asyncHandler(async (req, res) => {
  const meeting = await loadOwned(req);
  if (meeting.status !== 'active') throw ENDED();
  const user = await User.findById(req.userId);
  if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
  const pid = newParticipantId();
  const token = signRoomToken({ pid, roomId: meeting.roomId, role: 'host', uid: req.userId, did: getDeviceId(req, res), name: user.displayName });
  res.json({ token, meeting: hostView(meeting), you: { id: pid, name: user.displayName } });
}));

// Bumping inviteVersion changes the signature of every invite, so old links stop working immediately.
router.post('/:roomId/regenerate-invite', requireAuth, validateBody(regenerateSchema), asyncHandler(async (req, res) => {
  const meeting = await loadOwned(req);
  if (meeting.status !== 'active') throw ENDED();
  const set = {};
  if (req.body.inviteExpiresInHours !== undefined) set.inviteExpiresAt = expiryFrom(req.body.inviteExpiresInHours);
  const updated = await Meeting.findOneAndUpdate(
    { _id: meeting._id, status: 'active' },
    { $inc: { inviteVersion: 1 }, ...(Object.keys(set).length ? { $set: set } : {}) },
    { returnDocument: 'after' }
  );
  audit('invite_regenerated', { roomId: meeting.roomId, userId: req.userId });
  res.json({ meeting: hostView(updated) });
}));

router.post('/:roomId/end', requireAuth, asyncHandler(async (req, res) => {
  const meeting = await loadOwned(req);
  await endMeeting(meeting.roomId);
  audit('meeting_ended', { roomId: meeting.roomId, userId: req.userId });
  res.status(204).end();
}));

// ---------------------------------------------------------------- guests: lookup / join
// What the join page needs before it shows a form. Fails identically for every kind of bad invite.
router.post('/lookup', lookupLimiter, optionalAuth, validateBody(lookupSchema), asyncHandler(async (req, res) => {
  const meeting = await resolveOrThrow(req.body.invite);
  const host = await User.findById(meeting.host).select('displayName');
  const isHost = Boolean(req.userId) && String(meeting.host) === String(req.userId);
  res.json({
    title: meeting.title,
    hostName: host?.displayName ?? 'the host',
    requiresPasscode: meeting.hasPasscode,
    locked: meeting.locked,
    ...(isHost ? { isHost: true, roomId: meeting.roomId } : {}),
  });
}));

router.post('/join', joinLimiter, optionalAuth, validateBody(joinSchema), joinFailLimiter, asyncHandler(async (req, res) => {
  const { invite, displayName, passcode } = req.body;
  const meeting = await resolveOrThrow(invite);
  const deviceId = getDeviceId(req, res);

  if (req.userId && String(meeting.host) === String(req.userId)) {
    throw new AppError(409, 'IS_HOST', 'You host this meeting. Open it from your dashboard.');
  }
  if (isBanned(meeting, deviceId, req.userId)) throw new AppError(403, 'JOIN_DENIED', 'You can’t join this meeting.');
  if (meeting.locked && !wasAdmitted(meeting.roomId, deviceId)) throw new AppError(423, 'LOCKED', 'The host has locked this meeting.');

  if (meeting.hasPasscode) {
    if (meeting.passcodeLockedUntil && meeting.passcodeLockedUntil > new Date()) {
      throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Too many incorrect passcodes. Try again in a few minutes.');
    }
    const ok = typeof passcode === 'string' && (await verifyPassword(meeting.passcodeHash, passcode));
    if (!ok) {
      const upd = await Meeting.findOneAndUpdate({ _id: meeting._id }, { $inc: { passcodeFailures: 1 } }, { returnDocument: 'after' }).select('+passcodeFailures');
      if (upd.passcodeFailures >= 20) {
        await Meeting.updateOne({ _id: meeting._id }, { $set: { passcodeFailures: 0, passcodeLockedUntil: new Date(Date.now() + 10 * 60_000) } });
      }
      audit('passcode_failed', { roomId: meeting.roomId });
      throw new AppError(403, 'BAD_PASSCODE', 'That passcode is incorrect.');
    }
    if (meeting.passcodeFailures) await Meeting.updateOne({ _id: meeting._id }, { $set: { passcodeFailures: 0 } });
  }

  const pid = newParticipantId();
  const token = signRoomToken({ pid, roomId: meeting.roomId, role: 'guest', uid: req.userId, did: deviceId, name: displayName });
  audit('join_requested', { roomId: meeting.roomId, pid });
  res.json({ token, roomId: meeting.roomId, you: { id: pid, name: displayName } });
}));

export default router;