import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job, Queue } from 'bullmq';
import type { Env } from '../config/env.js';
import { scheduleEvery } from '../jobs/schedule.js';
import { AuditRetentionService } from './audit-retention.service.js';

export const AUDIT_QUEUE = 'audit';
export const REMOVE_EXPIRED_AUDIT_LOGS = 'remove-expired-audit-logs';

/** The audit log's background jobs: removing expired records, once a day. */
@Processor(AUDIT_QUEUE)
export class AuditProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuditProcessor.name);

  constructor(
    @InjectQueue(AUDIT_QUEUE) private readonly queue: Queue,
    private readonly retention: AuditRetentionService,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
  }

  async onApplicationBootstrap() {
    const nodeEnv = this.config.get('NODE_ENV', { infer: true });
    await scheduleEvery(this.queue, REMOVE_EXPIRED_AUDIT_LOGS, 24 * 60 * 60 * 1000, nodeEnv);
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== REMOVE_EXPIRED_AUDIT_LOGS) {
      throw new Error(`Unknown job ${job.name}`);
    }
    const removed = await this.retention.removeExpired();
    if (removed > 0) {
      this.logger.log(`Removed ${removed} expired audit records`);
    }
    return { removed };
  }
}
