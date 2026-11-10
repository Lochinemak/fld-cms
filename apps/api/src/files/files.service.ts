import {
  extensionOf,
  fileNameSchema,
  type FileVersion,
  type Page,
  type StoredFile,
  type StoredFileDetail,
  type StoredFileQuery,
  type UpdateStoredFileInput,
} from '@fld/shared';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuditService, changesOf } from '../audit/audit.service.js';
import type { Principal } from '../auth/principal.js';
import { TENANT_PRISMA, tenantIdOf, type TenantPrisma } from '../authz/tenant-prisma.js';
import { toNamedRef, toUserRef } from '../crm/crm-scope.js';
import type { Prisma } from '../generated/prisma/client.js';
import { SnowflakeService } from '../snowflake/snowflake.service.js';
import { Storage, StorageObjectNotFoundError } from '../storage/storage.js';
import { mimeTypeOf, sendFileContent } from './file-content.js';
import { FileRefsService } from './file-refs.service.js';
import {
  ancestorsOf,
  type FilesDb,
  fileSelect,
  folderIdOf,
  fileSiblingsIn,
  freeName,
  freeNameStem,
  lockFile,
  lockPlacement,
  type Placement,
  requireVisibleFile,
  requireVisibleFolder,
  sameName,
  storageKeyOf,
  toFile,
  visibleFiles,
} from './file-scope.js';
import { removeUpload, type UploadedTempFile } from './upload.js';

/** The current version and the 10 before it. */
const KEPT_VERSIONS = 11;

const versionSelect = {
  id: true,
  number: true,
  size: true,
  mimeType: true,
  restoredFrom: true,
  createdAt: true,
  uploader: { select: { id: true, displayName: true } },
} satisfies Prisma.FileVersionSelect;

function toVersion(
  row: Prisma.FileVersionGetPayload<{ select: typeof versionSelect }>,
): FileVersion {
  return {
    id: row.id.toString(),
    number: row.number,
    size: Number(row.size),
    mimeType: row.mimeType,
    uploader: toUserRef(row.uploader),
    restoredFrom: row.restoredFrom,
    createdAt: row.createdAt.toISOString(),
  };
}

interface NewVersion {
  id: bigint;
  storageKey: string;
  size: bigint;
  mimeType: string;
  restoredFrom: number | null;
}

/**
 * Files of the file library. Each upload and each replacement is a version with contents of its
 * own in storage; the file shows the latest.
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly snowflake: SnowflakeService,
    private readonly storage: Storage,
    private readonly refs: FileRefsService,
    private readonly audit: AuditService,
  ) {}

  /** A folder's files by name, or with a keyword, matching files from every folder, latest first. */
  async list(user: Principal, query: StoredFileQuery): Promise<Page<StoredFile>> {
    const { page, pageSize, keyword, folderId } = query;
    let where: Prisma.StoredFileWhereInput;
    let orderBy: Prisma.StoredFileOrderByWithRelationInput[];
    if (keyword) {
      where = { AND: [visibleFiles(user), { name: { contains: keyword, mode: 'insensitive' } }] };
      orderBy = [{ updatedAt: 'desc' }, { id: 'desc' }];
    } else {
      const folder = folderId
        ? (await requireVisibleFolder(this.db, user, BigInt(folderId))).id
        : null;
      where = { AND: [visibleFiles(user), { folderId: folder }] };
      orderBy = [{ name: 'asc' }, { id: 'asc' }];
    }
    const [rows, total] = await Promise.all([
      this.db.storedFile.findMany({
        where,
        select: fileSelect,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.storedFile.count({ where }),
    ]);
    return { items: rows.map(toFile), total };
  }

  async get(user: Principal, id: string): Promise<StoredFileDetail> {
    const fileId = BigInt(id);
    const row = await this.db.storedFile.findFirst({
      where: { AND: [{ id: fileId }, visibleFiles(user)] },
      select: fileSelect,
    });
    if (!row) {
      throw new NotFoundException('文件不存在');
    }
    const [path, versions, { usages, hidden }] = await Promise.all([
      ancestorsOf(this.db, tenantIdOf(user), row.folder?.id ?? null),
      this.db.fileVersion.findMany({
        where: { fileId },
        select: versionSelect,
        orderBy: { number: 'desc' },
      }),
      this.refs.usagesOf(user, fileId),
    ]);
    return {
      ...toFile(row),
      path: path.map(toNamedRef),
      versions: versions.map(toVersion),
      usages,
      hiddenUsages: hidden,
    };
  }

  /**
   * Stores an upload as a new file. A name the place already has gets a number, as in
   * 「合同 (1).pdf」; nothing is overwritten.
   */
  async upload(
    user: Principal,
    folderId: string | undefined,
    upload: UploadedTempFile | undefined,
  ): Promise<StoredFile> {
    try {
      if (!upload) {
        throw new BadRequestException('请选择文件');
      }
      const name = nameOf(upload);
      const tenantId = tenantIdOf(user);
      const me = BigInt(user.id);
      const folder = folderId ? BigInt(folderId) : null;
      if (folder) {
        // Before storing anything; checked again under lock below.
        await requireVisibleFolder(this.db, user, folder);
      }
      const fileId = this.snowflake.next();
      const versionId = this.snowflake.next();
      const content = {
        storageKey: storageKeyOf(tenantId, fileId, versionId),
        size: BigInt(upload.size),
        mimeType: mimeTypeOf(name),
      };
      await this.storage.put(content.storageKey, upload.path, {
        size: upload.size,
        contentType: content.mimeType,
      });
      await this.removingOnFailure(content.storageKey, () =>
        this.db.$transaction(async (tx) => {
          const placement = await lockPlacement(tx, user, tenantId, folder, me);
          await tx.storedFile.create({
            data: {
              id: fileId,
              tenantId,
              folderId: placement.folderId,
              name: await freeFileName(tx, placement, name),
              version: 1,
              ...content,
              ownerId: placement.ownerId,
              deptId: placement.deptId,
              creatorId: me,
            },
            select: { id: true },
          });
          await tx.fileVersion.create({
            data: { id: versionId, tenantId, fileId, number: 1, ...content, uploaderId: me },
            select: { id: true },
          });
        }),
      );
      return await this.read(fileId);
    } finally {
      await removeUpload(upload);
    }
  }

  /**
   * Renames the file or moves it. Moving hands it to the owner and department of the folder, or
   * back to its creator at the top level.
   */
  async update(user: Principal, id: string, input: UpdateStoredFileInput): Promise<StoredFile> {
    const fileId = BigInt(id);
    const tenantId = tenantIdOf(user);
    await this.db.$transaction(async (tx) => {
      const file = await requireVisibleFile(tx, user, fileId);
      const folderId = input.folderId === undefined ? file.folderId : folderIdOf(input.folderId);
      const name = input.name ?? file.name;
      const placement = await lockPlacement(tx, user, tenantId, folderId, file.creatorId);
      await lockFile(tx, tenantId, fileId);
      if ((await requireVisibleFile(tx, user, fileId)).folderId !== file.folderId) {
        throw new ConflictException('文件刚被移动过，请刷新后重试');
      }
      const clash = await tx.storedFile.findFirst({
        where: {
          AND: [fileSiblingsIn(placement), { name: sameName(name) }, { id: { not: fileId } }],
        },
        select: { id: true },
      });
      if (clash) {
        throw new ConflictException('这里已有同名文件');
      }
      await tx.storedFile.update({
        where: { id: fileId },
        data:
          folderId === file.folderId
            ? { name }
            : { name, folderId, ownerId: placement.ownerId, deptId: placement.deptId },
        select: { id: true },
      });
    });
    return this.read(fileId);
  }

  /**
   * Deletes the file unless records use it. Its shares stop working at once; its contents go
   * 30 days later.
   */
  async remove(user: Principal, id: string): Promise<void> {
    const fileId = BigInt(id);
    const tenantId = tenantIdOf(user);
    const name = await this.db.$transaction(async (tx) => {
      await lockFile(tx, tenantId, fileId);
      const file = await requireVisibleFile(tx, user, fileId);
      await this.refs.assertUnused(tx, user, fileId);
      await tx.storedFile.update({
        where: { id: fileId },
        data: { deletedAt: new Date() },
        select: { id: true },
      });
      await tx.fileShare.deleteMany({ where: { fileId } });
      return file.name;
    });
    await this.audit.record({ action: 'file.delete', target: { type: 'file', id: fileId, name } });
  }

  async sendContent(
    user: Principal,
    id: string,
    request: Request,
    response: Response,
    download?: boolean,
  ): Promise<void> {
    const file = await requireVisibleFile(this.db, user, BigInt(id));
    await sendFileContent(this.storage, request, response, file, download);
  }

  async sendVersionContent(
    user: Principal,
    id: string,
    versionId: string,
    request: Request,
    response: Response,
    download?: boolean,
  ): Promise<void> {
    const file = await requireVisibleFile(this.db, user, BigInt(id));
    const version = await this.db.fileVersion.findFirst({
      where: { id: BigInt(versionId), fileId: file.id },
      select: { storageKey: true, size: true, mimeType: true },
    });
    if (!version) {
      throw new NotFoundException('版本不存在');
    }
    await sendFileContent(
      this.storage,
      request,
      response,
      { name: file.name, ...version },
      download,
    );
  }

  /**
   * Makes an upload the file's new version. The name and ID stay, so whatever uses the file gets
   * the new contents; the extension has to stay too.
   */
  async replace(
    user: Principal,
    id: string,
    upload: UploadedTempFile | undefined,
  ): Promise<StoredFileDetail> {
    try {
      if (!upload) {
        throw new BadRequestException('请选择文件');
      }
      const file = await requireVisibleFile(this.db, user, BigInt(id));
      const extension = extensionOf(file.name);
      if (extensionOf(baseName(upload.originalname)) !== extension) {
        throw new BadRequestException(
          extension ? `只能替换为同类型的文件（.${extension}）` : '只能替换为同样没有扩展名的文件',
        );
      }
      const versionId = this.snowflake.next();
      const version: NewVersion = {
        id: versionId,
        storageKey: storageKeyOf(tenantIdOf(user), file.id, versionId),
        size: BigInt(upload.size),
        mimeType: mimeTypeOf(file.name),
        restoredFrom: null,
      };
      await this.storage.put(version.storageKey, upload.path, {
        size: upload.size,
        contentType: version.mimeType,
      });
      await this.removingOnFailure(version.storageKey, () =>
        this.addVersion(user, file.id, version),
      );
      return await this.get(user, id);
    } finally {
      await removeUpload(upload);
    }
  }

  /** Makes an earlier version current again, as a new version; the others all stay. */
  async restore(user: Principal, id: string, versionId: string): Promise<StoredFileDetail> {
    const file = await requireVisibleFile(this.db, user, BigInt(id));
    const earlier = await this.db.fileVersion.findFirst({
      where: { id: BigInt(versionId), fileId: file.id },
      select: { number: true, storageKey: true, size: true, mimeType: true },
    });
    if (!earlier) {
      throw new NotFoundException('版本不存在');
    }
    if (earlier.number === file.version) {
      throw new BadRequestException('这已经是当前版本');
    }
    const newId = this.snowflake.next();
    const version: NewVersion = {
      id: newId,
      storageKey: storageKeyOf(tenantIdOf(user), file.id, newId),
      size: earlier.size,
      mimeType: earlier.mimeType,
      restoredFrom: earlier.number,
    };
    try {
      await this.storage.copy(earlier.storageKey, version.storageKey);
    } catch (error) {
      // Dropped by a newer version meanwhile.
      throw error instanceof StorageObjectNotFoundError
        ? new NotFoundException('版本不存在')
        : error;
    }
    await this.removingOnFailure(version.storageKey, () => this.addVersion(user, file.id, version));
    await this.audit.record({
      action: 'file.restore-version',
      target: { type: 'file', id: file.id, name: file.name },
      changes: changesOf([['恢复的版本', null, `第 ${earlier.number} 版`]]),
    });
    return this.get(user, id);
  }

  /** Makes stored contents the file's current version and drops the versions beyond those kept. */
  private async addVersion(user: Principal, fileId: bigint, version: NewVersion): Promise<void> {
    const tenantId = tenantIdOf(user);
    const dropped = await this.db.$transaction(async (tx) => {
      await lockFile(tx, tenantId, fileId);
      const file = await requireVisibleFile(tx, user, fileId);
      const number = file.version + 1;
      const { id, restoredFrom, ...content } = version;
      await tx.fileVersion.create({
        data: {
          id,
          tenantId,
          fileId,
          number,
          ...content,
          uploaderId: BigInt(user.id),
          restoredFrom,
        },
        select: { id: true },
      });
      await tx.storedFile.update({
        where: { id: fileId },
        data: { version: number, ...content },
        select: { id: true },
      });
      const old = await tx.fileVersion.findMany({
        where: { fileId, number: { lte: number - KEPT_VERSIONS } },
        select: { id: true, storageKey: true },
      });
      await tx.fileVersion.deleteMany({ where: { id: { in: old.map((row) => row.id) } } });
      return old.map((row) => row.storageKey);
    });
    for (const key of dropped) {
      await this.storage
        .remove(key)
        .catch((error: unknown) =>
          this.logger.warn(`Could not remove dropped version ${key}: ${String(error)}`),
        );
    }
  }

  /** Runs `work`, removing what was stored under `key` for it if it fails. */
  private async removingOnFailure<T>(key: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      await this.storage
        .remove(key)
        .catch((removal: unknown) =>
          this.logger.warn(`Could not remove ${key} after a failed write: ${String(removal)}`),
        );
      throw error;
    }
  }

  private async read(id: bigint): Promise<StoredFile> {
    const row = await this.db.storedFile.findUniqueOrThrow({ where: { id }, select: fileSelect });
    return toFile(row);
  }
}

/** The name without any folders an old browser may send before it. */
function baseName(name: string): string {
  return name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
}

function nameOf(upload: UploadedTempFile): string {
  const result = fileNameSchema.safeParse(baseName(upload.originalname));
  if (!result.success) {
    throw new BadRequestException(result.error.issues[0]?.message ?? '文件名不正确');
  }
  return result.data;
}

/** The name, or the first numbered one the place has free. */
async function freeFileName(db: FilesDb, placement: Placement, name: string): Promise<string> {
  const similar = await db.storedFile.findMany({
    where: {
      AND: [
        fileSiblingsIn(placement),
        { name: { startsWith: freeNameStem(name), mode: 'insensitive' } },
      ],
    },
    select: { name: true },
  });
  return freeName(name, new Set(similar.map((file) => file.name.toLowerCase())));
}
