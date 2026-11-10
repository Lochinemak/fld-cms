import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

const DAY = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY = 60 * 1000;
const RUN_INTERVAL = DAY;
const LOCK_KEY = 'audit-retention:lock';
/** Long enough for any run; lapses by itself if the instance holding it dies. */
const LOCK_SECONDS = 30 * 60;

/**
 * Removes audit records once they are older than AUDIT_RETENTION_DAYS. One API instance runs it
 * at a time, once a day.
 */
@Injectable()
export class AuditRetentionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AuditRetentionService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap() {
    // Tests remove old records when they choose to.
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') {
      return;
    }
    this.timer = setTimeout(() => {
      void this.run();
      this.timer = setInterval(() => void this.run(), RUN_INTERVAL).unref();
    }, FIRST_RUN_DELAY).unref();
  }

  onApplicationShutdown() {
    clearTimeout(this.timer);
  }

  /** Removes the records older than the retention period before `now`, and says how many. */
  async removeExpired(now = new Date()): Promise<number> {
    const days = this.config.get('AUDIT_RETENTION_DAYS', { infer: true });
    const { count } = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - days * DAY) } },
    });
    return count;
  }

  private async run(): Promise<void> {
    try {
      if ((await this.redis.set(LOCK_KEY, '1', 'EX', LOCK_SECONDS, 'NX')) !== 'OK') {
        return;
      }
    } catch (error) {
      this.logger.warn(`Skipped removing expired audit records: ${String(error)}`);
      return;
    }
    try {
      const count = await this.removeExpired();
      if (count > 0) {
        this.logger.log(`Removed ${count} expired audit records`);
      }
    } catch (error) {
      this.logger.error(
        'Removing expired audit records failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      await this.redis.del(LOCK_KEY).catch(() => undefined);
    }
  }
}
