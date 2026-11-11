import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job, Queue } from 'bullmq';
import type { Env } from '../config/env.js';
import { scheduleEvery } from '../jobs/schedule.js';
import { NotificationsService } from './notifications.service.js';

export const NOTIFICATIONS_QUEUE = 'notifications';
export const REMOVE_EXPIRED_NOTIFICATIONS = 'remove-expired-notifications';

/** Removes notifications older than 90 days, once a day. */
@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
  }

  async onApplicationBootstrap() {
    const nodeEnv = this.config.get('NODE_ENV', { infer: true });
    await scheduleEvery(this.queue, REMOVE_EXPIRED_NOTIFICATIONS, 24 * 60 * 60 * 1000, nodeEnv);
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== REMOVE_EXPIRED_NOTIFICATIONS) {
      throw new Error(`Unknown job ${job.name}`);
    }
    const removed = await this.notifications.removeExpired();
    if (removed > 0) {
      this.logger.log(`Removed ${removed} expired notifications`);
    }
    return { removed };
  }
}
