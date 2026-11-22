export const rooms = new Map();

export function getOrCreateRoom(meeting) {
  let room = rooms.get(meeting.roomId);
  if (!room) {
    room = {
      roomId: meeting.roomId,
      title: meeting.title || '',
      locked: Boolean(meeting.locked),
      maxParticipants: meeting.maxParticipants,
      participants: new Map(), // participantId -> { pid, socketId, name, role, userId, deviceId, status }
      admittedDevices: new Set(), // devices the host already let in; they may reconnect without waiting again
    };
    rooms.set(meeting.roomId, room);
  }
  return room;
}

export const wasAdmitted = (roomId, deviceId) => rooms.get(roomId)?.admittedDevices.has(deviceId) ?? false;
export const listByStatus = (room, status) => [...room.participants.values()].filter((p) => p.status === status);
export const admittedCount = (room) => listByStatus(room, 'admitted').length;

export const publicParticipant = (p) => ({ id: p.pid, name: p.name, role: p.role, mic: p.mic ?? null });