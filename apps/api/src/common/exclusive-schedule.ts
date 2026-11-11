import { randomUUID } from 'node:crypto';
import type { Logger } from '@nestjs/common';
import type { RedisService } from '../redis/redis.service.js';

const FIRST_RUN_DELAY = 60 * 1000;
/** Long enough for any run; lapses by itself if the instance holding it dies. */
const LOCK_SECONDS = 30 * 60;

// Releases the lock only while it is still the one this run took.
const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export interface ExclusiveJob {
  /** Says what the job does, for the log: "purging deleted files". */
  readonly name: string;
  readonly lockKey: string;
  readonly interval: number;
  /** Does the work, and returns a line to log when there was something to do. */
  run(): Promise<string | undefined>;
}

/**
 * Runs the job a minute after start and then every interval, on one API instance at a time: the
 * one that takes the lock in Redis. Returns the function that stops it.
 */
export function scheduleExclusive(redis: RedisService, logger: Logger, job: ExclusiveJob) {
  const runOnce = async () => {
    const token = randomUUID();
    try {
      if ((await redis.set(job.lockKey, token, 'EX', LOCK_SECONDS, 'NX')) !== 'OK') {
        return;
      }
    } catch (error) {
      logger.warn(`${job.name} skipped: ${String(error)}`);
      return;
    }
    try {
      const done = await job.run();
      if (done) {
        logger.log(done);
      }
    } catch (error) {
      logger.error(`${job.name} failed`, error instanceof Error ? error.stack : String(error));
    } finally {
      await redis.eval(RELEASE, 1, job.lockKey, token).catch(() => undefined);
    }
  };
  let timer: NodeJS.Timeout = setTimeout(() => {
    void runOnce();
    timer = setInterval(() => void runOnce(), job.interval).unref();
  }, FIRST_RUN_DELAY).unref();
  return () => clearTimeout(timer);
}
