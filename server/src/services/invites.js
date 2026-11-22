import crypto from 'node:crypto';
import Meeting from '../models/Meeting.js';
import { INVITE_KEY } from './keys.js';

const B64_22 = /^[A-Za-z0-9_-]{22}$/;

export const newRoomId = () => crypto.randomBytes(16).toString('base64url'); // 128 bits -> 22 chars
export const newParticipantId = () => crypto.randomBytes(12).toString('base64url'); // 16 chars
export const isRoomId = (v) => typeof v === 'string' && B64_22.test(v);

const sign = (roomId, version) =>
  crypto.createHmac('sha256', INVITE_KEY).update(`${roomId}.${version}`).digest().subarray(0, 16).toString('base64url');

export const makeInvite = (m) => `${m.roomId}.${sign(m.roomId, m.inviteVersion)}`;

export function parseInvite(raw) {
  if (typeof raw !== 'string' || raw.length > 64) return null;
  const parts = raw.split('.');
  if (parts.length !== 2 || !B64_22.test(parts[0]) || !B64_22.test(parts[1])) return null;
  return { roomId: parts[0], sig: parts[1] };
}

function signatureMatches(meeting, sig) {
  const expected = Buffer.from(sign(meeting.roomId, meeting.inviteVersion));
  const given = Buffer.from(sig);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export async function resolveInvite(raw) {
  const parsed = parseInvite(raw);
  if (!parsed) return null;
  const meeting = await Meeting.findOne({ roomId: parsed.roomId }).select(
    '+passcodeHash +passcodeFailures +passcodeLockedUntil +bannedDevices +bannedUsers'
  );
  if (!meeting || !signatureMatches(meeting, parsed.sig)) return null;
  if (meeting.status === 'ended') return { meeting, ended: true };
  if (meeting.inviteExpiresAt && meeting.inviteExpiresAt <= new Date()) return null;
  return { meeting, ended: false };
}

export function isBanned(meeting, deviceId, userId) {
  if (deviceId && meeting.bannedDevices?.includes(deviceId)) return true;
  if (userId && meeting.bannedUsers?.some((id) => String(id) === String(userId))) return true;
  return false;
}