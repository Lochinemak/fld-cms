import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job, Queue } from 'bullmq';
import type { Env } from '../config/env.js';
import { scheduleEvery } from '../jobs/schedule.js';
import {
  REMOVE_EXPIRED_SPREADSHEETS,
  RUN_SPREADSHEET_TASK,
  SPREADSHEETS_QUEUE,
  SpreadsheetsService,
} from './spreadsheets.service.js';

/** Runs exports and imports, and removes those older than 7 days once a day. */
@Processor(SPREADSHEETS_QUEUE)
export class SpreadsheetsProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(SpreadsheetsProcessor.name);

  constructor(
    @InjectQueue(SPREADSHEETS_QUEUE) private readonly queue: Queue,
    private readonly spreadsheets: SpreadsheetsService,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
  }

  async onApplicationBootstrap() {
    const nodeEnv = this.config.get('NODE_ENV', { infer: true });
    await scheduleEvery(this.queue, REMOVE_EXPIRED_SPREADSHEETS, 24 * 60 * 60 * 1000, nodeEnv);
  }

  async process(job: Job<{ taskId?: string }>): Promise<unknown> {
    switch (job.name) {
      case RUN_SPREADSHEET_TASK:
        await this.spreadsheets.run(BigInt(job.data.taskId!));
        return null;
      case REMOVE_EXPIRED_SPREADSHEETS: {
        const removed = await this.spreadsheets.removeExpired();
        if (removed > 0) {
          this.logger.log(`Removed ${removed} expired exports and imports`);
        }
        return { removed };
      }
      default:
        throw new Error(`Unknown job ${job.name}`);
    }
  }
}
