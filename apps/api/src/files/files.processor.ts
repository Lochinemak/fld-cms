import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job, Queue } from 'bullmq';
import type { Env } from '../config/env.js';
import { scheduleEvery } from '../jobs/schedule.js';
import { FilePurgeService } from './file-purge.service.js';

export const FILES_QUEUE = 'files';
export const PURGE_DELETED_FILES = 'purge-deleted-files';

/** The file library's background jobs: purging what was deleted 30 days ago, every hour. */
@Processor(FILES_QUEUE)
export class FilesProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(FilesProcessor.name);

  constructor(
    @InjectQueue(FILES_QUEUE) private readonly queue: Queue,
    private readonly purge: FilePurgeService,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
  }

  async onApplicationBootstrap() {
    const nodeEnv = this.config.get('NODE_ENV', { infer: true });
    await scheduleEvery(this.queue, PURGE_DELETED_FILES, 60 * 60 * 1000, nodeEnv);
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== PURGE_DELETED_FILES) {
      throw new Error(`Unknown job ${job.name}`);
    }
    const purged = await this.purge.purge();
    if (purged.files > 0 || purged.folders > 0) {
      this.logger.log(`Purged ${purged.files} deleted files and ${purged.folders} deleted folders`);
    }
    return purged;
  }
}
