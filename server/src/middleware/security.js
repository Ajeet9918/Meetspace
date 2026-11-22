import helmet from 'helmet';
import cors from 'cors';
import mongoSanitize from 'express-mongo-sanitize';
import env from '../config/env.js';

/** Production: redirect HTTP to HTTPS. Relies on TRUST_PROXY so req.secure is accurate. */
export function httpsRedirect(req, res, next) {
  if (!env.isProd || req.secure) return next();
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(426).json({ error: { code: 'HTTPS_REQUIRED', message: 'HTTPS is required' } });
  return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
}

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"], // no inline scripts, no eval
      styleSrc: ["'self'"], // Tailwind is compiled to a file; fonts are self-hosted
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
      fontSrc: ["'self'"],
      connectSrc: ["'self'", ...env.CLIENT_ORIGINS.map((o) => o.replace(/^http/, 'ws')), ...(env.LIVEKIT_URL ? [env.LIVEKIT_URL, env.LIVEKIT_URL.replace(/^ws/, 'http')] : [])],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"], // clickjacking defence
      ...(env.isProd ? { upgradeInsecureRequests: [] } : {}),
    },
  },
  hsts: env.isProd ? { maxAge: 63_072_000, includeSubDomains: true, preload: true } : false,
  referrerPolicy: { policy: 'no-referrer' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
});

/** helmet has no Permissions-Policy helper. Camera, mic and screen capture are limited to our own origin. */
export function permissionsPolicy(_req, res, next) {
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=()');
  next();
}

const allowed = new Set(env.CLIENT_ORIGINS);
export const isAllowedOrigin = (origin) => allowed.has(origin);

export const corsMiddleware = cors({
  origin(origin, cb) {
    // No Origin header = same-origin navigation or non-browser client; CSRF checks still apply.
    if (!origin || isAllowedOrigin(origin)) return cb(null, true);
    return cb(null, false); // omit CORS headers; the browser blocks the response
  },
  credentials: true,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  maxAge: 600,
});

// Strips keys beginning with "$" or containing "." from body/params/headers (NoSQL operator injection).
// zod schemas are the primary defence; this is defence in depth.
export const sanitizeMongo = mongoSanitize({ replaceWith: '_' });
