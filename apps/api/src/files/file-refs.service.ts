import type { Attachment, FileRefTarget, FileUsage } from '@fld/shared';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Principal } from '../auth/principal.js';
import { TENANT_PRISMA, tenantIdOf, type TenantPrisma } from '../authz/tenant-prisma.js';
import { toUserRef, visibleCustomers } from '../crm/crm-scope.js';
import { Prisma } from '../generated/prisma/client.js';
import { SnowflakeService } from '../snowflake/snowflake.service.js';
import type { FileContent } from './file-content.js';
import { type FilesDb, visibleFiles } from './file-scope.js';

/** A record files can be attached to. */
export interface FileRefTargetRef {
  type: FileRefTarget;
  id: bigint;
}

const TARGET_NAMES: Record<FileRefTarget, string> = { CUSTOMER: '客户' };

interface RefRow {
  targetType: FileRefTarget;
  targetId: bigint;
}

const refRowSelect = { targetType: true, targetId: true } satisfies Prisma.FileRefSelect;

/**
 * Which records use which files. A file in use cannot be deleted, and whoever sees a record can
 * open the files attached to it, whether or not the files are in their data scope.
 */
@Injectable()
export class FileRefsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly snowflake: SnowflakeService,
  ) {}

  /** The records using the file that the user can see, and how many more there are. */
  async usagesOf(
    user: Principal,
    fileId: bigint,
  ): Promise<{ usages: FileUsage[]; hidden: number }> {
    const refs = await this.db.fileRef.findMany({
      where: { fileId },
      select: refRowSelect,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return this.describe(user, refs);
  }

  /** Refuses to go on while records use the file, saying which. */
  async assertUnused(tx: FilesDb, user: Principal, fileId: bigint): Promise<void> {
    const refs = await tx.fileRef.findMany({
      where: { fileId },
      select: refRowSelect,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (refs.length > 0) {
      throw new ConflictException(
        `该文件正在被使用，不能删除。用在：${await this.usedIn(user, refs)}`,
      );
    }
  }

  /** Refuses to go on while records use any of a folder's files, giving one as an example. */
  async assertFolderUnused(tx: FilesDb, user: Principal, fileIds: bigint[]): Promise<void> {
    if (fileIds.length === 0) {
      return;
    }
    const refs = await tx.fileRef.findMany({
      where: { fileId: { in: fileIds } },
      select: { ...refRowSelect, fileId: true, file: { select: { name: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const [first] = refs;
    if (!first) {
      return;
    }
    const used = new Set(refs.map((ref) => ref.fileId)).size;
    const example = refs.filter((ref) => ref.fileId === first.fileId);
    throw new ConflictException(
      `文件夹里有 ${used} 个文件正在被使用，不能删除。比如「${first.file.name}」用在：${await this.usedIn(user, example)}`,
    );
  }

  /**
   * Attaches files the user can see to a record. The caller holds the record's row, so that it
   * cannot go away meanwhile.
   */
  async attach(
    tx: FilesDb,
    user: Principal,
    target: FileRefTargetRef,
    fileIds: readonly bigint[],
  ): Promise<void> {
    const tenantId = tenantIdOf(user);
    const ids = [...new Set(fileIds)];
    // Keeps the files from being deleted until the references are in.
    await tx.$queryRaw`
      SELECT id FROM files WHERE tenant_id = ${tenantId} AND id IN (${Prisma.join(ids)})
      ORDER BY id FOR SHARE`;
    const visible = await tx.storedFile.count({
      where: { AND: [{ id: { in: ids } }, visibleFiles(user)] },
    });
    if (visible < ids.length) {
      throw new NotFoundException('文件不存在');
    }
    await tx.fileRef.createMany({
      data: ids.map((fileId) => ({
        id: this.snowflake.next(),
        tenantId,
        fileId,
        targetType: target.type,
        targetId: target.id,
        creatorId: BigInt(user.id),
      })),
      skipDuplicates: true,
    });
  }

  /** Takes the file off the record; the file itself stays. */
  async detach(target: FileRefTargetRef, fileId: bigint): Promise<void> {
    const { count } = await this.db.fileRef.deleteMany({
      where: { fileId, targetType: target.type, targetId: target.id },
    });
    if (count === 0) {
      throw new NotFoundException('附件不存在');
    }
  }

  /** Takes every file off a record that is going away. */
  async detachAll(tx: FilesDb, target: FileRefTargetRef): Promise<void> {
    await tx.fileRef.deleteMany({ where: { targetType: target.type, targetId: target.id } });
  }

  /** The files attached to the record, the latest first. */
  async attachments(target: FileRefTargetRef): Promise<Attachment[]> {
    const refs = await this.db.fileRef.findMany({
      where: { targetType: target.type, targetId: target.id },
      select: {
        createdAt: true,
        creator: { select: { id: true, displayName: true } },
        file: { select: { id: true, name: true, size: true, mimeType: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return refs.map((ref) => ({
      file: {
        id: ref.file.id.toString(),
        name: ref.file.name,
        size: Number(ref.file.size),
        mimeType: ref.file.mimeType,
      },
      attachedBy: toUserRef(ref.creator),
      attachedAt: ref.createdAt.toISOString(),
    }));
  }

  /** The current contents of a file attached to the record. */
  async attachedContent(target: FileRefTargetRef, fileId: bigint): Promise<FileContent> {
    const ref = await this.db.fileRef.findFirst({
      where: { fileId, targetType: target.type, targetId: target.id },
      select: {
        file: {
          select: { name: true, storageKey: true, size: true, mimeType: true, deletedAt: true },
        },
      },
    });
    if (!ref || ref.file.deletedAt) {
      throw new NotFoundException('附件不存在');
    }
    return ref.file;
  }

  private async describe(
    user: Principal,
    refs: RefRow[],
  ): Promise<{ usages: FileUsage[]; hidden: number }> {
    const customerIds = refs
      .filter((ref) => ref.targetType === 'CUSTOMER')
      .map((ref) => ref.targetId);
    const customers = customerIds.length
      ? await this.db.customer.findMany({
          where: { AND: [{ id: { in: customerIds } }, visibleCustomers(user)] },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(customers.map((customer) => [`CUSTOMER:${customer.id}`, customer.name]));
    const usages: FileUsage[] = [];
    for (const ref of refs) {
      const name = names.get(`${ref.targetType}:${ref.targetId}`);
      if (name !== undefined) {
        usages.push({ type: ref.targetType, id: ref.targetId.toString(), name });
      }
    }
    return { usages, hidden: refs.length - usages.length };
  }

  /**
   * Where the references are, naming up to three records the user can see and only counting the
   * rest, e.g. 客户「A」、客户「B」，以及 2 处你看不到的记录.
   */
  private async usedIn(user: Principal, refs: RefRow[]): Promise<string> {
    const { usages, hidden } = await this.describe(user, refs);
    const shown = usages
      .slice(0, 3)
      .map((usage) => `${TARGET_NAMES[usage.type]}「${usage.name}」`)
      .join('、');
    const named = usages.length > 3 ? `${shown} 等 ${usages.length} 处` : shown;
    if (hidden === 0) {
      return named;
    }
    const unseen = `${hidden} 处你看不到的记录`;
    return named ? `${named}，以及 ${unseen}` : unseen;
  }
}
