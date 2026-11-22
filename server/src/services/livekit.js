import { AccessToken, RoomServiceClient, TrackType } from 'livekit-server-sdk';
import env from '../config/env.js';
import logger from '../utils/logger.js';

export const livekitEnabled = Boolean(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET);
const svc = livekitEnabled
  ? new RoomServiceClient(env.LIVEKIT_URL.replace(/^ws/, 'http'), env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET)
  : null;

const safe = (label, p) => p.catch((e) => logger.warn({ label, err: { message: e.message } }, 'media server call failed'));

export async function mediaToken(participant, room) {
  if (!room.mediaRoomReady) {
    // Cap the media room at the meeting limit too, so the limit holds even at the media layer.
    await safe('createRoom', svc.createRoom({ name: room.roomId, maxParticipants: room.maxParticipants, emptyTimeout: 300 }));
    room.mediaRoomReady = true;
  }
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, { identity: participant.pid, name: participant.name, ttl: 120 });
  at.addGrant({ roomJoin: true, room: room.roomId, canPublish: true, canSubscribe: true, canPublishData: false });
  return at.toJwt();
}

/** Enforced mute: the media server mutes the audio track. The person may unmute themselves afterwards. */
export async function muteInMedia(roomId, pid) {
  if (!svc) return;
  await safe('mute', (async () => {
    const p = await svc.getParticipant(roomId, pid);
    for (const t of p.tracks) if (t.type === TrackType.AUDIO && !t.muted) await svc.mutePublishedTrack(roomId, pid, t.sid, true);
  })());
}
export const removeFromMedia = (roomId, pid) => (svc ? safe('remove', svc.removeParticipant(roomId, pid)) : Promise.resolve());
export const closeMediaRoom = (roomId) => (svc ? safe('deleteRoom', svc.deleteRoom(roomId)) : Promise.resolve());