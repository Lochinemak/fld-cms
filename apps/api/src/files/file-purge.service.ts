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
import { Storage } from '../storage/storage.js';

const RETENTION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY = 60 * 1000;
const RUN_INTERVAL = 60 * 60 * 1000;
const LOCK_KEY = 'file-purge:lock';
/** Long enough for any run; lapses by itself if the instance holding it dies. */
const LOCK_SECONDS = 30 * 60;
const BATCH_SIZE = 100;

/**
 * Removes deleted files and folders for good once they have been deleted for 30 days: the
 * contents of every version from storage, then the rows. One API instance runs it at a time,
 * every hour.
 */
@Injectable()
export class FilePurgeService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(FilePurgeService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: Storage,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap() {
    // Tests purge when they choose to.
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

  /** Purges what was deleted more than 30 days before `now`, and says how much. */
  async purge(now = new Date()): Promise<{ files: number; folders: number }> {
    const before = new Date(now.getTime() - RETENTION_DAYS * DAY);
    let files = 0;
    for (;;) {
      const batch = await this.prisma.storedFile.findMany({
        // A file in use is never deleted; one that somehow is, waits rather than blocks the rest.
        where: { deletedAt: { lt: before }, refs: { none: {} } },
        select: { id: true, versions: { select: { storageKey: true } } },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
      });
      if (batch.length === 0) {
        break;
      }
      // Versions and shares go with their file.
      const { count } = await this.prisma.storedFile.deleteMany({
        where: { id: { in: batch.map((file) => file.id) } },
      });
      files += count;
      for (const key of batch.flatMap((file) =>
        file.versions.map((version) => version.storageKey),
      )) {
        await this.storage
          .remove(key)
          .catch((error: unknown) => this.logger.warn(`Could not remove ${key}: ${String(error)}`));
      }
      if (count === 0) {
        break;
      }
    }
    let folders = 0;
    for (;;) {
      // Innermost first: a folder goes once nothing is left in it.
      const count = await this.prisma.$executeRaw`
        DELETE FROM file_folders f
        WHERE f.deleted_at < ${before}
          AND NOT EXISTS (SELECT 1 FROM file_folders c WHERE c.parent_id = f.id)
          AND NOT EXISTS (SELECT 1 FROM files x WHERE x.folder_id = f.id)`;
      if (count === 0) {
        break;
      }
      folders += count;
    }
    return { files, folders };
  }

  private async run(): Promise<void> {
    try {
      if ((await this.redis.set(LOCK_KEY, '1', 'EX', LOCK_SECONDS, 'NX')) !== 'OK') {
        return;
      }
    } catch (error) {
      this.logger.warn(`Skipped purging deleted files: ${String(error)}`);
      return;
    }
    try {
      const { files, folders } = await this.purge();
      if (files > 0 || folders > 0) {
        this.logger.log(`Purged ${files} deleted files and ${folders} deleted folders`);
      }
    } catch (error) {
      this.logger.error(
        'Purging deleted files failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      await this.redis.del(LOCK_KEY).catch(() => undefined);
    }
  }
}
