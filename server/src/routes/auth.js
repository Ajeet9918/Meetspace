import { Router } from 'express';
import { z } from 'zod';
import env from '../config/env.js';
import User from '../models/User.js';
import { asyncHandler, AppError } from '../utils/errors.js';
import { audit } from '../utils/logger.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { loginLimiter, signupLimiter, refreshLimiter } from '../middleware/rateLimit.js';
import { issueCsrfToken } from '../middleware/csrf.js';
import { hashPassword, verifyPassword, verifyAgainstDummy } from '../services/password.js';
import {
  REFRESH_COOKIE, CSRF_COOKIE, refreshCookieOptions, csrfCookieOptions,
  signAccessToken, issueRefreshToken, rotateRefreshToken, revokeFamilyByToken, revokeAllForUser,
} from '../services/tokens.js';

const router = Router();

// Auth responses must never be cached by browsers or proxies.
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// ---- Schemas: strictObject rejects unexpected keys; string types reject {"$gt": ""} style operator objects.
const email = z.string().trim().toLowerCase().email().max(254);
const displayName = z
  .string().trim().min(1, 'Name is required').max(50, 'Name must be 50 characters or fewer')
  .refine((v) => !/[\u0000-\u001F\u007F<>]/.test(v), 'Name contains invalid characters');
const signupSchema = z.strictObject({
  displayName,
  email,
  // Max length bounds argon2 work per request (DoS guard); min follows current NIST guidance toward length.
  password: z.string().min(12, 'Password must be at least 12 characters').max(128, 'Password must be 128 characters or fewer'),
});
const loginSchema = z.strictObject({ email, password: z.string().min(1).max(128) });

const GENERIC_LOGIN_ERROR = () => new AppError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');

async function startSession(res, user, ip) {
  const refresh = await issueRefreshToken(user._id);
  res.cookie(REFRESH_COOKIE, refresh, refreshCookieOptions());
  return { accessToken: signAccessToken(user._id.toString()), user: user.toPublic() };
}

const clearAuthCookies = (res) => {
  const { maxAge, ...rest } = refreshCookieOptions();
  res.clearCookie(REFRESH_COOKIE, rest);
  res.clearCookie(CSRF_COOKIE, csrfCookieOptions());
};

// ---- GET /api/auth/csrf
router.get('/csrf', (_req, res) => {
  res.json({ csrfToken: issueCsrfToken(res) });
});

// ---- POST /api/auth/signup
router.post('/signup', signupLimiter, validateBody(signupSchema), asyncHandler(async (req, res) => {
  const { displayName: name, email: mail, password } = req.body;
  if (password.toLowerCase().includes(mail.split('@')[0]) && mail.split('@')[0].length >= 4) {
    throw new AppError(400, 'VALIDATION', 'Invalid input');
  }
  const passwordHash = await hashPassword(password); // hash before the DB write so timing is uniform
  let user;
  try {
    user = await User.create({ displayName: name, email: mail, passwordHash });
  } catch (err) {
    if (err?.code === 11000) {
      // Without email verification, signup cannot fully avoid revealing an existing email. See README limitations.
      throw new AppError(409, 'ACCOUNT_EXISTS', 'Unable to create an account with those details');
    }
    throw err;
  }
  audit('signup', { userId: user.id, ip: req.ip });
  res.status(201).json(await startSession(res, user));
}));

// ---- POST /api/auth/login
router.post('/login', loginLimiter, validateBody(loginSchema), asyncHandler(async (req, res) => {
  const { email: mail, password } = req.body;
  const user = await User.findOne({ email: mail }).select('+passwordHash +failedLoginAttempts +lockUntil');
  const locked = Boolean(user?.lockUntil && user.lockUntil > new Date());

  if (!user || locked) {
    // Same work, same message, same status as a wrong password. Locked accounts are indistinguishable from unknown ones.
    await verifyAgainstDummy(password);
    audit('login_failed', { ip: req.ip, locked: locked || undefined });
    throw GENERIC_LOGIN_ERROR();
  }

  if (!(await verifyPassword(user.passwordHash, password))) {
    const updated = await User.findOneAndUpdate({ _id: user._id }, { $inc: { failedLoginAttempts: 1 } }, { returnDocument: 'after' }).select('+failedLoginAttempts');
    if (updated.failedLoginAttempts >= env.MAX_FAILED_LOGINS) {
      await User.updateOne({ _id: user._id }, { $set: { lockUntil: new Date(Date.now() + env.LOCKOUT_MINUTES * 60_000), failedLoginAttempts: 0 } });
      audit('account_locked', { userId: user.id, ip: req.ip });
    }
    audit('login_failed', { userId: user.id, ip: req.ip });
    throw GENERIC_LOGIN_ERROR();
  }

  await User.updateOne({ _id: user._id }, { $set: { failedLoginAttempts: 0, lockUntil: null } });
  audit('login', { userId: user.id, ip: req.ip });
  res.json(await startSession(res, user));
}));

// ---- POST /api/auth/refresh  (cookie-authenticated, CSRF-protected, rotating)
router.post('/refresh', refreshLimiter, asyncHandler(async (req, res) => {
  const presented = req.cookies?.[REFRESH_COOKIE];
  if (typeof presented !== 'string' || presented.length > 200) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');

  const result = await rotateRefreshToken(presented);
  if (!result || result.reuseDetected) {
    if (result?.reuseDetected) audit('refresh_reuse_detected', { userId: result.userId, ip: req.ip });
    const { maxAge, ...rest } = refreshCookieOptions();
    res.clearCookie(REFRESH_COOKIE, rest);
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
  }

  const user = await User.findById(result.userId);
  if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');

  res.cookie(REFRESH_COOKIE, result.token, refreshCookieOptions());
  res.json({ accessToken: signAccessToken(user.id), user: user.toPublic() });
}));

// ---- POST /api/auth/logout
router.post('/logout', asyncHandler(async (req, res) => {
  const presented = req.cookies?.[REFRESH_COOKIE];
  if (typeof presented === 'string') await revokeFamilyByToken(presented);
  clearAuthCookies(res);
  res.status(204).end();
}));

// ---- POST /api/auth/logout-all
router.post('/logout-all', requireAuth, asyncHandler(async (req, res) => {
  await revokeAllForUser(req.userId);
  audit('logout_all', { userId: req.userId });
  clearAuthCookies(res);
  res.status(204).end();
}));

// ---- GET /api/auth/me
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
  res.json({ user: user.toPublic() });
}));

export default router;
