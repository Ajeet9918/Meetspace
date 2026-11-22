import crypto from 'node:crypto';
import env from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { isAllowedOrigin } from './security.js';
import { CSRF_COOKIE, csrfCookieOptions, newCsrfToken } from '../services/tokens.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence in three layers for cookie-based endpoints:
 *  1. SameSite=Strict cookies (browser never sends them cross-site)
 *  2. Origin header must be on the allowlist for unsafe methods
 *  3. Double-submit token: httpOnly cookie must match the X-CSRF-Token header.
 *     The token is delivered in a JSON body, which other origins cannot read.
 */
export function csrfProtection(req, _res, next) {
  if (SAFE.has(req.method)) return next();

  const origin = req.headers.origin;
  if (origin && !isAllowedOrigin(origin)) return next(new AppError(403, 'BAD_ORIGIN', 'Request origin not allowed'));

  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.get('x-csrf-token');
  if (typeof cookie !== 'string' || typeof header !== 'string' || cookie.length !== header.length || cookie.length === 0) {
    return next(new AppError(403, 'CSRF', 'Invalid CSRF token'));
  }
  if (!crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(header))) {
    return next(new AppError(403, 'CSRF', 'Invalid CSRF token'));
  }
  return next();
}

export function issueCsrfToken(res) {
  const token = newCsrfToken();
  res.cookie(CSRF_COOKIE, token, csrfCookieOptions());
  return token;
}
