import crypto from 'node:crypto';
import env from '../config/env.js';

// Domain-separated sub-keys derived from the master secret with HKDF. A key leaked or
// misused in one context (say, forged invite links) is useless in another (room tokens),
// and no extra secrets need to be configured.
const derive = (label) => Buffer.from(crypto.hkdfSync('sha256', env.JWT_ACCESS_SECRET, 'meetspace/v1', label, 32));

export const ROOM_TOKEN_KEY = derive('room-token');
export const INVITE_KEY = derive('invite-link');