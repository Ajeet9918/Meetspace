import crypto from 'node:crypto';
import env from '../config/env.js';

const NAME = env.isProd ? '__Secure-device' : 'device_id';
const VALID = /^[A-Za-z0-9_-]{22}$/;

export function getDeviceId(req, res) {
  const existing = req.cookies?.[NAME];
  if (typeof existing === 'string' && VALID.test(existing)) return existing;
  const id = crypto.randomBytes(16).toString('base64url');
  res.cookie(NAME, id, { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'strict', path: '/api/meetings', maxAge: 365 * 86_400_000 });
  return id;
}