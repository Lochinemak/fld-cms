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
import { scheduleExclusive } from '../common/exclusive-schedule.js';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Removes audit records once they are older than AUDIT_RETENTION_DAYS. One API instance runs it
 * at a time, once a day.
 */
@Injectable()
export class AuditRetentionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AuditRetentionService.name);
  private stop?: () => void;

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
    this.stop = scheduleExclusive(this.redis, this.logger, {
      name: 'Removing expired audit records',
      lockKey: 'fld:audit-retention:lock',
      interval: DAY,
      run: async () => {
        const count = await this.removeExpired();
        return count > 0 ? `Removed ${count} expired audit records` : undefined;
      },
    });
  }

  onApplicationShutdown() {
    this.stop?.();
  }

  /** Removes the records older than the retention period before `now`, and says how many. */
  async removeExpired(now = new Date()): Promise<number> {
    const days = this.config.get('AUDIT_RETENTION_DAYS', { infer: true });
    const { count } = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - days * DAY) } },
    });
    return count;
  }
}
