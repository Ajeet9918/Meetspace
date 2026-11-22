import jwt from 'jsonwebtoken';
import { ROOM_TOKEN_KEY } from './keys.js';

const OPTS = { issuer: 'meetspace', audience: 'meetspace-room' };

export function signRoomToken({ pid, roomId, role, uid, did, name }) {
  return jwt.sign({ rid: roomId, role, uid, did, name }, ROOM_TOKEN_KEY, {
    algorithm: 'HS256',
    subject: pid,
    expiresIn: '6h',
    ...OPTS,
  });
}

export const verifyRoomToken = (token) => jwt.verify(token, ROOM_TOKEN_KEY, { algorithms: ['HS256'], ...OPTS });