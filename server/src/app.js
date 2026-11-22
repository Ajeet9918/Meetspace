import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import env from './config/env.js';
import logger from './utils/logger.js';
import { httpsRedirect, securityHeaders, permissionsPolicy, corsMiddleware, sanitizeMongo } from './middleware/security.js';
import { csrfProtection } from './middleware/csrf.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.js';
import meetingRoutes from './routes/meeting.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY);

app.use(httpsRedirect);
app.use(
  pinoHttp({
    logger,
    genReqId: () => crypto.randomUUID(),
    autoLogging: { ignore: (req) => req.url === '/api/health' },
    // Log only method, path (no query string, which could carry tokens) and status.
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url.split('?')[0].replace(/^\/m\/[^/]+/, '/m/[invite]') }), // invite links are capabilities: never log them
      res: (res) => ({ statusCode: res.statusCode }),
    },
  })
);
app.use(securityHeaders);
app.use(permissionsPolicy);
app.use(corsMiddleware);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api', apiLimiter);
app.use(express.json({ limit: '10kb' })); // small body cap; chat and signaling get their own limits later
app.use(cookieParser());
app.use(sanitizeMongo);
app.use('/api', csrfProtection);
app.use('/api/auth', authRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api', notFound);

// Production: serve the built React app from the same origin (simplifies cookies, CSP and CORS).
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use(notFound);
app.use(errorHandler);

export default app;