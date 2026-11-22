export function consume(socket, name, { capacity, refillPerSec }) {
  const now = Date.now();
  const buckets = (socket.data.buckets ??= {});
  const b = (buckets[name] ??= { tokens: capacity, at: now });
  b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 1000) * refillPerSec);
  b.at = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

export const LIMITS = {
  control: { name: 'control', capacity: 20, refillPerSec: 2 }, // admit, deny, lock, remove, end
  turn: { name: 'turn', capacity: 6, refillPerSec: 0.05 }, // credential requests
  chat: { name: 'chat', capacity: 5, refillPerSec: 1 }, // about one message per second sustained
  state: { name: 'state', capacity: 20, refillPerSec: 5 }, // mic on/off notices
  signal: { name: 'signal', capacity: 150, refillPerSec: 60 }, // offers, answers, ICE candidates
};