import env from '../config/env.js';
import Meeting from '../models/Meeting.js';
import logger, { audit } from '../utils/logger.js';
import { liveRoomIds } from '../realtime/index.js';

export function startCleanupJob() {
  const run = async () => {
    try {
      const now = Date.now();
      const res = await Meeting.updateMany(
        {
          status: 'active',
          roomId: { $nin: liveRoomIds() },
          lastActivityAt: { $lt: new Date(now - env.MEETING_IDLE_MINUTES * 60_000) },
        },
        { $set: { status: 'ended', endedAt: new Date(now), purgeAt: new Date(now + env.ENDED_RETENTION_HOURS * 3_600_000) } }
      );
      if (res.modifiedCount) audit('idle_meetings_ended', { count: res.modifiedCount });
    } catch (err) {
      logger.error({ err: { message: err.message } }, 'cleanup failed');
    }
  };
  const timer = setInterval(run, 5 * 60_000);
  timer.unref();
  return () => clearInterval(timer);
}