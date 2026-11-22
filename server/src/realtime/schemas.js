import { z } from 'zod';

const pid = z.string().regex(/^[A-Za-z0-9_-]{16}$/);

export const empty = z.union([z.undefined(), z.null(), z.strictObject({})]);
export const idPayload = z.strictObject({ id: pid });
export const lockPayload = z.strictObject({ locked: z.boolean() });

const sdp = (type) => z.strictObject({ type: z.literal(type), sdp: z.string().max(30_000) });
const ice = z.strictObject({
  candidate: z.string().max(2_000),
  sdpMid: z.string().max(100).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(255).nullable().optional(),
  usernameFragment: z.string().max(100).nullable().optional(),
});

// "from" is deliberately absent: the server stamps the sender itself.
export const signalPayload = z.discriminatedUnion('kind', [
  z.strictObject({ to: pid, kind: z.literal('offer'), data: sdp('offer') }),
  z.strictObject({ to: pid, kind: z.literal('answer'), data: sdp('answer') }),
  z.strictObject({ to: pid, kind: z.literal('ice'), data: ice }),
]);
const unsafe = /[\u0000-\u0008\u000B-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g;
export const chatPayload = z.strictObject({
  text: z.string().max(2000).transform((v) => v.replace(unsafe, '').trim()).pipe(z.string().min(1).max(500)),
});
export const mediaPayload = z.strictObject({ mic: z.boolean() });