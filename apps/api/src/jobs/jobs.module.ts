import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

/**
 * The connection settings of a redis:// or rediss:// URL, database index included, as plain
 * options: BullMQ brings its own ioredis.
 */
export function redisOptions(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    ...(parsed.username && { username: decodeURIComponent(parsed.username) }),
    ...(parsed.password && { password: decodeURIComponent(parsed.password) }),
    db: Number(parsed.pathname.slice(1) || 0),
    ...(parsed.protocol === 'rediss:' && { tls: {} }),
  };
}

/**
 * Background jobs on BullMQ, in the API's Redis. Each module registers its own queue with
 * `BullModule.registerQueue()` and a `@Processor()` for it; a job a schedule repeats runs once,
 * on whichever API instance takes it, however many there are.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: redisOptions(config.get('REDIS_URL', { infer: true })),
        prefix: 'fld:jobs',
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          // Enough history to look into, without Redis filling up.
          removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
          removeOnFail: { age: 30 * 24 * 3600 },
        },
      }),
    }),
  ],
})
export class JobsModule {}
