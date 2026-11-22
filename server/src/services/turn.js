import crypto from 'node:crypto';
import env from '../config/env.js';

export function turnCredentials(participantId, nowMs = Date.now()) {
  const iceServers = [];
  if (env.STUN_URLS.length) iceServers.push({ urls: env.STUN_URLS });
  if (!env.TURN_SECRET || env.TURN_URLS.length === 0) return { iceServers, expiresAt: null };

  const expiry = Math.floor(nowMs / 1000) + env.TURN_TTL_SECONDS;
  const username = `${expiry}:${participantId}`;
  const credential = crypto.createHmac('sha1', env.TURN_SECRET).update(username).digest('base64');
  iceServers.push({ urls: env.TURN_URLS, username, credential });
  return { iceServers, expiresAt: expiry * 1000 };
}