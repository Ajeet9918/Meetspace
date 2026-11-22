import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const make = (windowMinutes, limit, message, extra = {}) =>
  rateLimit({
    windowMs: windowMinutes * 60_000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message } }),
    ...extra,
  });
export const apiLimiter = make(15, 300, 'Too many requests. Please slow down.');
export const loginLimiter = make(15, 10, 'Too many login attempts. Try again later.', { skipSuccessfulRequests: true });
export const signupLimiter = make(60, 5, 'Too many sign-up attempts. Try again later.');
export const refreshLimiter = make(15, 60, 'Too many requests. Please slow down.');

export const createLimiter = make(60, 30, 'Too many meetings created. Try again later.');
export const lookupLimiter = make(15, 60, 'Too many requests. Please slow down.');
export const joinLimiter = make(15, 40, 'Too many join attempts. Try again later.');

export const joinFailLimiter = make(15, 8, 'Too many failed attempts. Try again later.', {
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.invite ?? '').slice(0, 22)}`,
});
