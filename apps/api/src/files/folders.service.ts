import type {
  CreateFileFolderInput,
  FileFolder,
  FileFolderDetail,
  FileFolderQuery,
  UpdateFileFolderInput,
} from '@fld/shared';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Principal } from '../auth/principal.js';
import { TENANT_PRISMA, tenantIdOf, type TenantPrisma } from '../authz/tenant-prisma.js';
import { toNamedRef } from '../crm/crm-scope.js';
import { SnowflakeService } from '../snowflake/snowflake.service.js';
import { FileRefsService } from './file-refs.service.js';
import {
  ancestorsOf,
  type FilesDb,
  folderIdOf,
  folderSelect,
  folderSiblingsIn,
  folderTree,
  lockFolderTree,
  lockPlacement,
  type Placement,
  requireVisibleFolder,
  sameName,
  toFolder,
  visibleFolders,
} from './file-scope.js';

/**
 * Folders of the file library. What a folder holds takes its owner and department, so whoever
 * sees a folder sees everything in it.
 */
@Injectable()
export class FoldersService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly snowflake: SnowflakeService,
    private readonly refs: FileRefsService,
  ) {}

  async list(user: Principal, { parentId }: FileFolderQuery): Promise<FileFolder[]> {
    const parent = parentId
      ? (await requireVisibleFolder(this.db, user, BigInt(parentId))).id
      : null;
    const rows = await this.db.fileFolder.findMany({
      where: { AND: [visibleFolders(user), { parentId: parent }] },
      select: folderSelect,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toFolder);
  }

  async get(user: Principal, id: string): Promise<FileFolderDetail> {
    const row = await this.db.fileFolder.findFirst({
      where: { AND: [{ id: BigInt(id) }, visibleFolders(user)] },
      select: folderSelect,
    });
    if (!row) {
      throw new NotFoundException('文件夹不存在');
    }
    const path = await ancestorsOf(this.db, tenantIdOf(user), row.parentId);
    return { ...toFolder(row), path: path.map(toNamedRef) };
  }

  async create(user: Principal, { name, parentId }: CreateFileFolderInput): Promise<FileFolder> {
    const me = BigInt(user.id);
    const tenantId = tenantIdOf(user);
    const id = await this.db.$transaction(async (tx) => {
      const placement = await lockPlacement(tx, user, tenantId, folderIdOf(parentId), me);
      await assertNameFree(tx, placement, name);
      const folder = await tx.fileFolder.create({
        data: {
          id: this.snowflake.next(),
          tenantId,
          parentId: placement.folderId,
          name,
          ownerId: placement.ownerId,
          deptId: placement.deptId,
          creatorId: me,
        },
        select: { id: true },
      });
      return folder.id;
    });
    return this.read(id);
  }

  /**
   * Renames the folder or moves it. Moving hands it and everything in it to the owner and
   * department of the new parent, or back to its creator at the top level.
   */
  async update(user: Principal, id: string, input: UpdateFileFolderInput): Promise<FileFolder> {
    const folderId = BigInt(id);
    const tenantId = tenantIdOf(user);
    await this.db.$transaction(async (tx) => {
      await lockFolderTree(tx, tenantId);
      const folder = await requireVisibleFolder(tx, user, folderId);
      const parentId = input.parentId === undefined ? folder.parentId : folderIdOf(input.parentId);
      const name = input.name ?? folder.name;
      const placement = await lockPlacement(tx, user, tenantId, parentId, folder.creatorId);
      if (parentId === folder.parentId) {
        await assertNameFree(tx, placement, name, folderId);
        await tx.fileFolder.update({
          where: { id: folderId },
          data: { name },
          select: { id: true },
        });
        return;
      }
      if (parentId) {
        const above = await ancestorsOf(tx, tenantId, parentId);
        if (above.some((ancestor) => ancestor.id === folderId)) {
          throw new BadRequestException('不能把文件夹移到它自己或它的子文件夹里');
        }
      }
      await assertNameFree(tx, placement, name, folderId);
      await tx.fileFolder.update({
        where: { id: folderId },
        data: { name, parentId, ownerId: placement.ownerId, deptId: placement.deptId },
        select: { id: true },
      });
      // Folders before files, the order every transaction here locks them in.
      await tx.$executeRaw`
        ${folderTree(tenantId, folderId)}
        UPDATE file_folders SET owner_id = ${placement.ownerId}, dept_id = ${placement.deptId}
        WHERE tenant_id = ${tenantId} AND id IN (SELECT id FROM tree) AND id <> ${folderId}`;
      await tx.$executeRaw`
        ${folderTree(tenantId, folderId)}
        UPDATE files SET owner_id = ${placement.ownerId}, dept_id = ${placement.deptId}
        WHERE tenant_id = ${tenantId} AND folder_id IN (SELECT id FROM tree)`;
    });
    return this.read(folderId);
  }

  /**
   * Deletes the folder with everything in it, unless a file in it is in use. The shares of its
   * files stop working at once; the contents go 30 days later.
   */
  async remove(user: Principal, id: string): Promise<void> {
    const folderId = BigInt(id);
    const tenantId = tenantIdOf(user);
    await this.db.$transaction(async (tx) => {
      await lockFolderTree(tx, tenantId);
      await requireVisibleFolder(tx, user, folderId);
      const folders = await tx.$queryRaw<{ id: bigint }[]>`
        ${folderTree(tenantId, folderId)}
        SELECT id FROM file_folders
        WHERE tenant_id = ${tenantId} AND id IN (SELECT id FROM tree) AND deleted_at IS NULL
        ORDER BY id FOR UPDATE`;
      const files = await tx.$queryRaw<{ id: bigint }[]>`
        ${folderTree(tenantId, folderId)}
        SELECT id FROM files
        WHERE tenant_id = ${tenantId} AND folder_id IN (SELECT id FROM tree) AND deleted_at IS NULL
        ORDER BY id FOR UPDATE`;
      const fileIds = files.map((file) => file.id);
      await this.refs.assertFolderUnused(tx, user, fileIds);
      const deletedAt = new Date();
      await tx.fileFolder.updateMany({
        where: { id: { in: folders.map((folder) => folder.id) } },
        data: { deletedAt },
      });
      await tx.storedFile.updateMany({ where: { id: { in: fileIds } }, data: { deletedAt } });
      await tx.fileShare.deleteMany({ where: { fileId: { in: fileIds } } });
    });
  }

  private async read(id: bigint): Promise<FileFolder> {
    const row = await this.db.fileFolder.findUniqueOrThrow({ where: { id }, select: folderSelect });
    return toFolder(row);
  }
}

async function assertNameFree(
  db: FilesDb,
  placement: Placement,
  name: string,
  except?: bigint,
): Promise<void> {
  const clash = await db.fileFolder.findFirst({
    where: {
      AND: [
        folderSiblingsIn(placement),
        { name: sameName(name) },
        except ? { id: { not: except } } : {},
      ],
    },
    select: { id: true },
  });
  if (clash) {
    throw new ConflictException('这里已有同名文件夹');
  }
}
