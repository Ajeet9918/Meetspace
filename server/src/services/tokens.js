import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import RefreshToken from '../models/RefreshToken.js';

const ISSUER = 'meetspace';
const AUDIENCE = 'meetspace-api';
const DAY_MS = 86_400_000;
const REUSE_GRACE_MS = 10_000; // tolerates two tabs refreshing at the same instant

export const REFRESH_COOKIE = env.isProd ? '__Secure-refresh' : 'refresh_token';
export const CSRF_COOKIE = env.isProd ? '__Secure-csrf' : 'csrf_token';

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url'); // 256 bits

export function signAccessToken(userId) {
  return jwt.sign({}, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  });
}

export function verifyAccessToken(token) {
  // Algorithm is pinned, which blocks "alg: none" and algorithm-confusion attacks.
  return jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE });
}

export const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'strict',
  path: '/api/auth', // sent only to auth endpoints
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * DAY_MS,
});

export const csrfCookieOptions = () => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'strict',
  path: '/api',
});

/** Starts a new session (login/signup): new family, first refresh token. */
export async function issueRefreshToken(userId, family = crypto.randomUUID(), familyExpiresAt) {
  const now = Date.now();
  const cap = familyExpiresAt ?? new Date(now + env.SESSION_MAX_DAYS * DAY_MS);
  const expiresAt = new Date(Math.min(now + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS, cap.getTime()));
  const token = randomToken();
  await RefreshToken.create({ user: userId, tokenHash: sha256(token), family, expiresAt, familyExpiresAt: cap });
  return token;
}

/**
 * Rotation: each refresh token is single-use. The claim is one atomic update, so two
 * concurrent requests cannot both succeed. Presenting an already-used token outside
 * the grace window is treated as theft and revokes the whole session family.
 * Returns { userId, token } or null.
 */
export async function rotateRefreshToken(presented) {
  const tokenHash = sha256(presented);
  const now = new Date();

  const claimed = await RefreshToken.findOneAndUpdate(
    { tokenHash, revokedAt: null, expiresAt: { $gt: now }, familyExpiresAt: { $gt: now } },
    { $set: { revokedAt: now } },
    { returnDocument: 'before' }
  );

  if (claimed) {
    const token = await issueRefreshToken(claimed.user, claimed.family, claimed.familyExpiresAt);
    return { userId: claimed.user.toString(), token, family: claimed.family };
  }

  const existing = await RefreshToken.findOne({ tokenHash });
  if (existing?.revokedAt && now - existing.revokedAt > REUSE_GRACE_MS) {
    await RefreshToken.updateMany({ family: existing.family, revokedAt: null }, { $set: { revokedAt: now } });
    return { reuseDetected: true, userId: existing.user.toString(), family: existing.family };
  }
  return null;
}

export async function revokeFamilyByToken(presented) {
  const doc = await RefreshToken.findOne({ tokenHash: sha256(presented) });
  if (doc) await RefreshToken.updateMany({ family: doc.family, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

export const revokeAllForUser = (userId) =>
  RefreshToken.updateMany({ user: userId, revokedAt: null }, { $set: { revokedAt: new Date() } });

export const newCsrfToken = randomToken;
