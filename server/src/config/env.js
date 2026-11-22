import 'dotenv/config';
import { z } from 'zod';

const urlList = (re, msg) =>
  z.string().transform((v) => v.split(',').map((x) => x.trim()).filter(Boolean)).refine((l) => l.every((u) => re.test(u)), msg);

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGODB_URI: z.string().min(1),
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters')
    .refine((v) => !v.includes('REPLACE_ME'), 'JWT_ACCESS_SECRET is still the placeholder'),
  CLIENT_ORIGINS: z
    .string()
    .min(1)
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean))
    .refine((list) => list.every((o) => /^https?:\/\/[^*\s]+$/.test(o)), 'CLIENT_ORIGINS must be exact origins, no wildcards'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  COOKIE_SECURE: bool.default(false),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  SESSION_MAX_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  MAX_FAILED_LOGINS: z.coerce.number().int().min(3).max(20).default(5),
  LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  MEETING_IDLE_MINUTES: z.coerce.number().int().min(5).max(10080).default(120),
  ENDED_RETENTION_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  MAX_WAITING: z.coerce.number().int().min(1).max(300).default(100),
  LIVEKIT_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^wss?:\/\/[^\s]+$/, 'LIVEKIT_URL must start with ws:// or wss://').optional()),
  LIVEKIT_API_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(3).optional()),
  LIVEKIT_API_SECRET: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(6).refine((v) => !v.includes('REPLACE_ME'), 'LIVEKIT_API_SECRET is still the placeholder').optional()),
  STUN_URLS: urlList(/^stun:/, 'STUN_URLS must be stun: URLs').default(['stun:stun.l.google.com:19302']),
  TURN_URLS: urlList(/^turns?:/, 'TURN_URLS must be turn: or turns: URLs').default([]),
  TURN_SECRET: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(32, 'TURN_SECRET must be at least 32 characters').refine((v) => !v.includes('REPLACE_ME'), 'TURN_SECRET is still the placeholder').optional()),
  TURN_TTL_SECONDS: z.coerce.number().int().min(300).max(86400).default(3600),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  for (const issue of parsed.error.issues) {
    console.error(`Invalid environment: ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const env = parsed.data;
env.isProd = env.NODE_ENV === 'production';

if (env.isProd) {
    if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET || env.LIVEKIT_API_SECRET.length < 32) {
    console.error('Invalid environment: LIVEKIT_URL, LIVEKIT_API_KEY and a LIVEKIT_API_SECRET of 32+ characters are required in production');
    process.exit(1);
  }
  if (!env.LIVEKIT_URL.startsWith('wss://')) {
    console.error('Invalid environment: LIVEKIT_URL must be wss:// in production');
    process.exit(1);
  }
  if (!env.COOKIE_SECURE) {
    console.error('Invalid environment: COOKIE_SECURE must be true in production');
    process.exit(1);
  }
  if (!env.CLIENT_ORIGINS.every((o) => o.startsWith('https://'))) {
    console.error('Invalid environment: CLIENT_ORIGINS must all be https:// in production');
    process.exit(1);
  }
}


export default Object.freeze(env);
