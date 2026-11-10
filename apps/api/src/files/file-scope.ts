import { extensionOf, type FileFolder, type StoredFile } from '@fld/shared';
import { NotFoundException } from '@nestjs/common';
import type { Principal } from '../auth/principal.js';
import { dataScopeWhere } from '../authz/data-scope.js';
import type { TenantPrisma } from '../authz/tenant-prisma.js';
import { ownDept, toNamedRef, toUserRef } from '../crm/crm-scope.js';
import { Prisma } from '../generated/prisma/client.js';

/** The tenant Prisma client, or a transaction of it. */
export type FilesDb = Pick<
  TenantPrisma,
  | 'fileFolder'
  | 'storedFile'
  | 'fileVersion'
  | 'fileShare'
  | 'fileRef'
  | 'tenantMember'
  | '$executeRaw'
  | '$queryRaw'
>;

/** Folders the user's data scope covers, deleted ones left out. */
export function visibleFolders(user: Principal): Prisma.FileFolderWhereInput {
  return {
    AND: [
      { deletedAt: null },
      dataScopeWhere<Prisma.FileFolderWhereInput>(user, { dept: 'deptId', owner: 'ownerId' }),
    ],
  };
}

/** Files the user's data scope covers, deleted ones left out. */
export function visibleFiles(user: Principal): Prisma.StoredFileWhereInput {
  return {
    AND: [
      { deletedAt: null },
      dataScopeWhere<Prisma.StoredFileWhereInput>(user, { dept: 'deptId', owner: 'ownerId' }),
    ],
  };
}

export async function requireVisibleFolder(db: FilesDb, user: Principal, id: bigint) {
  const folder = await db.fileFolder.findFirst({
    where: { AND: [{ id }, visibleFolders(user)] },
    select: { id: true, parentId: true, name: true, ownerId: true, deptId: true, creatorId: true },
  });
  if (!folder) {
    throw new NotFoundException('文件夹不存在');
  }
  return folder;
}

export const fileContentSelect = {
  id: true,
  name: true,
  folderId: true,
  ownerId: true,
  creatorId: true,
  version: true,
  storageKey: true,
  size: true,
  mimeType: true,
} satisfies Prisma.StoredFileSelect;

export type FileContentRow = Prisma.StoredFileGetPayload<{ select: typeof fileContentSelect }>;

export async function requireVisibleFile(
  db: FilesDb,
  user: Principal,
  id: bigint,
): Promise<FileContentRow> {
  const file = await db.storedFile.findFirst({
    where: { AND: [{ id }, visibleFiles(user)] },
    select: fileContentSelect,
  });
  if (!file) {
    throw new NotFoundException('文件不存在');
  }
  return file;
}

/** The folder to put something in, given as an ID or null for the top level. */
export function folderIdOf(id: string | null): bigint | null {
  return id === null ? null : BigInt(id);
}

/**
 * Where an item goes: into a folder, taking the folder's owner and department, or to the top
 * level, where it belongs to its creator.
 */
export interface Placement {
  folderId: bigint | null;
  ownerId: bigint;
  deptId: bigint | null;
}

/**
 * The placement in `folderId`, or at the top level for an item `creatorId` created. Holds the
 * place until the transaction ends, so that names there stay unique and the folder stays put.
 */
export async function lockPlacement(
  tx: FilesDb,
  user: Principal,
  tenantId: bigint,
  folderId: bigint | null,
  creatorId: bigint,
): Promise<Placement> {
  if (folderId) {
    await tx.$executeRaw`
      SELECT 1 FROM file_folders WHERE tenant_id = ${tenantId} AND id = ${folderId} FOR UPDATE`;
    const folder = await requireVisibleFolder(tx, user, folderId);
    return { folderId, ownerId: folder.ownerId, deptId: folder.deptId };
  }
  const deptId =
    creatorId === BigInt(user.id)
      ? ownDept(user)
      : ((
          await tx.tenantMember.findFirst({
            where: { userId: creatorId },
            select: { deptId: true },
          })
        )?.deptId ?? null);
  const topLevel = `file-top-level:${tenantId}:${creatorId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${topLevel}, 0))`;
  return { folderId: null, ownerId: creatorId, deptId };
}

/**
 * The files next to which one in `placement` sits. At the top level, each owner has a space of
 * their own.
 */
export function fileSiblingsIn(placement: Placement): Prisma.StoredFileWhereInput {
  return placement.folderId
    ? { folderId: placement.folderId, deletedAt: null }
    : { folderId: null, ownerId: placement.ownerId, deletedAt: null };
}

/** The folders next to which one in `placement` sits, as for files. */
export function folderSiblingsIn(placement: Placement): Prisma.FileFolderWhereInput {
  return placement.folderId
    ? { parentId: placement.folderId, deletedAt: null }
    : { parentId: null, ownerId: placement.ownerId, deletedAt: null };
}

/** Names are the same when they differ only in letter case, as on Windows and macOS. */
export function sameName(name: string) {
  return { equals: name, mode: 'insensitive' } as const;
}

const MAX_COUNTER = ' (999999999)'.length;

function splitExtension(name: string): [base: string, suffix: string] {
  const extension = extensionOf(name);
  const suffix = extension ? name.slice(name.length - extension.length - 1) : '';
  return [name.slice(0, name.length - suffix.length), suffix];
}

/** A prefix every name `freeName` may come up with for `name` starts with. */
export function freeNameStem(name: string, max = 255): string {
  const [base, suffix] = splitExtension(name);
  return base.slice(0, max - MAX_COUNTER - suffix.length);
}

/**
 * `name`, or the first `name (n)` that none of `taken` has in any letter case, keeping the
 * extension. `taken` holds names in lower case.
 */
export function freeName(name: string, taken: ReadonlySet<string>, max = 255): string {
  if (!taken.has(name.toLowerCase())) {
    return name;
  }
  const [base, suffix] = splitExtension(name);
  for (let n = 1; ; n++) {
    const counter = ` (${n})`;
    const candidate = `${base.slice(0, max - counter.length - suffix.length)}${counter}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
}

/**
 * Makes moves and deletions of folders in the tenant wait for each other until the transaction
 * ends, so that two moves cannot together put a folder inside itself.
 */
export async function lockFolderTree(tx: FilesDb, tenantId: bigint): Promise<void> {
  const key = `file-folder-tree:${tenantId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

/**
 * Holds the file's row until the transaction ends. Takes it after any folder lock, as every
 * transaction here does, so that they cannot deadlock.
 */
export async function lockFile(tx: FilesDb, tenantId: bigint, fileId: bigint): Promise<void> {
  await tx.$executeRaw`
    SELECT 1 FROM files WHERE tenant_id = ${tenantId} AND id = ${fileId} FOR UPDATE`;
}

/** A `tree` query of the folder and every folder below it, deleted ones included. */
export function folderTree(tenantId: bigint, folderId: bigint): Prisma.Sql {
  return Prisma.sql`
    WITH RECURSIVE tree AS (
      SELECT id FROM file_folders WHERE tenant_id = ${tenantId} AND id = ${folderId}
      UNION ALL
      SELECT f.id FROM file_folders f
      JOIN tree ON f.parent_id = tree.id
      WHERE f.tenant_id = ${tenantId}
    )`;
}

/** The folder and the folders above it, from the top level down. */
export function ancestorsOf(
  db: FilesDb,
  tenantId: bigint,
  folderId: bigint | null,
): Promise<{ id: bigint; name: string }[]> {
  if (!folderId) {
    return Promise.resolve([]);
  }
  return db.$queryRaw<{ id: bigint; name: string }[]>`
    WITH RECURSIVE up AS (
      SELECT id, parent_id, name, 0 AS depth FROM file_folders
      WHERE tenant_id = ${tenantId} AND id = ${folderId}
      UNION ALL
      SELECT f.id, f.parent_id, f.name, up.depth + 1 FROM file_folders f
      JOIN up ON f.id = up.parent_id
      WHERE f.tenant_id = ${tenantId}
    )
    SELECT id, name FROM up ORDER BY depth DESC`;
}

export const folderSelect = {
  id: true,
  parentId: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: { id: true, displayName: true } },
  creator: { select: { id: true, displayName: true } },
  department: { select: { id: true, name: true } },
} satisfies Prisma.FileFolderSelect;

export function toFolder(
  row: Prisma.FileFolderGetPayload<{ select: typeof folderSelect }>,
): FileFolder {
  return {
    id: row.id.toString(),
    parentId: row.parentId?.toString() ?? null,
    name: row.name,
    owner: toUserRef(row.owner),
    dept: row.department && toNamedRef(row.department),
    creator: toUserRef(row.creator),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const fileSelect = {
  id: true,
  name: true,
  size: true,
  mimeType: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  folder: { select: { id: true, name: true } },
  owner: { select: { id: true, displayName: true } },
  creator: { select: { id: true, displayName: true } },
  department: { select: { id: true, name: true } },
} satisfies Prisma.StoredFileSelect;

export function toFile(
  row: Prisma.StoredFileGetPayload<{ select: typeof fileSelect }>,
): StoredFile {
  return {
    id: row.id.toString(),
    name: row.name,
    folder: row.folder && toNamedRef(row.folder),
    size: Number(row.size),
    mimeType: row.mimeType,
    version: row.version,
    owner: toUserRef(row.owner),
    dept: row.department && toNamedRef(row.department),
    creator: toUserRef(row.creator),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Where the contents of a file version live. */
export function storageKeyOf(tenantId: bigint, fileId: bigint, versionId: bigint): string {
  return `files/${tenantId}/${fileId}/${versionId}`;
}
