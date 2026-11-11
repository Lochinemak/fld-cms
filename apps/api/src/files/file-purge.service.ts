import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Storage } from '../storage/storage.js';

const RETENTION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 100;

/**
 * Removes deleted files and folders for good once they have been deleted for 30 days: the
 * contents of every version from storage, then the rows. FilesProcessor runs it every hour.
 */
@Injectable()
export class FilePurgeService {
  private readonly logger = new Logger(FilePurgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: Storage,
  ) {}

  /**
   * Purges what was deleted more than 30 days before `now`, and says how much. A file's contents
   * go before its row, so a file whose contents could not be removed keeps its row and is tried
   * again on the next run, rather than leaving them in storage with nothing pointing at them.
   */
  async purge(now = new Date()): Promise<{ files: number; folders: number }> {
    const before = new Date(now.getTime() - RETENTION_DAYS * DAY);
    let files = 0;
    let after = 0n;
    for (;;) {
      const batch = await this.prisma.storedFile.findMany({
        // A file in use is never deleted; one that somehow is, waits rather than blocks the rest.
        where: { id: { gt: after }, deletedAt: { lt: before }, refs: { none: {} } },
        select: { id: true, versions: { select: { storageKey: true } } },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
      });
      if (batch.length === 0) {
        break;
      }
      after = batch[batch.length - 1]!.id;
      const removed: bigint[] = [];
      for (const file of batch) {
        try {
          for (const { storageKey } of file.versions) {
            await this.storage.remove(storageKey);
          }
          removed.push(file.id);
        } catch (error) {
          this.logger.warn(`Could not remove the contents of file ${file.id}: ${String(error)}`);
        }
      }
      // Versions and shares go with their file.
      const { count } = await this.prisma.storedFile.deleteMany({
        where: { id: { in: removed }, deletedAt: { lt: before }, refs: { none: {} } },
      });
      files += count;
    }
    let folders = 0;
    for (;;) {
      // Innermost first: a folder goes once nothing is left in it.
      const count = await this.prisma.$executeRaw`
        DELETE FROM file_folders f
        WHERE f.deleted_at < ${before}
          AND NOT EXISTS (
            SELECT 1 FROM file_folders c WHERE c.tenant_id = f.tenant_id AND c.parent_id = f.id)
          AND NOT EXISTS (
            SELECT 1 FROM files x WHERE x.tenant_id = f.tenant_id AND x.folder_id = f.id)`;
      if (count === 0) {
        break;
      }
      folders += count;
    }
    return { files, folders };
  }
}
