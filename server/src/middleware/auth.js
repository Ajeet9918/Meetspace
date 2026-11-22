import { verifyAccessToken } from '../services/tokens.js';
import { AppError } from '../utils/errors.js';

/** Requires "Authorization: Bearer <access JWT>". Sets req.userId. */
export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required'));
  try {
    req.userId = verifyAccessToken(token).sub;
    return next();
  } catch {
    return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required'));
  }
}

export function optionalAuth(req, _res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Bearer' && token) {
    try { req.userId = verifyAccessToken(token).sub; } catch { /* treated as anonymous */ }
  }
  next();
}