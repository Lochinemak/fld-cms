import { randomBytes, randomInt } from 'node:crypto';
import type { CreateFileShareInput, FileShare } from '@fld/shared';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService, changesOf } from '../audit/audit.service.js';
import type { Principal } from '../auth/principal.js';
import { TENANT_PRISMA, tenantIdOf, type TenantPrisma } from '../authz/tenant-prisma.js';
import { toUserRef } from '../crm/crm-scope.js';
import type { Prisma } from '../generated/prisma/client.js';
import { SnowflakeService } from '../snowflake/snowflake.service.js';
import { lockFile, requireVisibleFile, visibleFiles } from './file-scope.js';

/** Letters and digits that cannot be mistaken for one another. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;
const DAY = 24 * 60 * 60 * 1000;

const shareSelect = {
  id: true,
  token: true,
  code: true,
  expiresAt: true,
  accessCount: true,
  lastAccessedAt: true,
  createdAt: true,
  creator: { select: { id: true, displayName: true } },
} satisfies Prisma.FileShareSelect;

function toShare(row: Prisma.FileShareGetPayload<{ select: typeof shareSelect }>): FileShare {
  return {
    id: row.id.toString(),
    token: row.token,
    code: row.code,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    accessCount: row.accessCount,
    lastAccessedAt: row.lastAccessedAt?.toISOString() ?? null,
    creator: toUserRef(row.creator),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Codes are shown and compared in upper case. */
export function newShareCode(): string {
  return Array.from(
    { length: CODE_LENGTH },
    () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
  ).join('');
}

/**
 * Links that let anyone open a file without signing in. A file can have several, each revoked on
 * its own; they all point at the file, so they show its current version.
 */
@Injectable()
export class FileSharesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly snowflake: SnowflakeService,
    private readonly audit: AuditService,
  ) {}

  async list(user: Principal, fileId: string): Promise<FileShare[]> {
    const file = await requireVisibleFile(this.db, user, BigInt(fileId));
    const rows = await this.db.fileShare.findMany({
      where: { fileId: file.id },
      select: shareSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toShare);
  }

  async create(
    user: Principal,
    fileId: string,
    { expiresInDays, withCode }: CreateFileShareInput,
  ): Promise<FileShare> {
    const tenantId = tenantIdOf(user);
    const { id, file } = await this.db.$transaction(async (tx) => {
      // So that a file being deleted meanwhile cannot end up with a link.
      await lockFile(tx, tenantId, BigInt(fileId));
      const file = await requireVisibleFile(tx, user, BigInt(fileId));
      const share = await tx.fileShare.create({
        data: {
          id: this.snowflake.next(),
          tenantId,
          fileId: file.id,
          token: randomBytes(24).toString('base64url'),
          code: withCode ? newShareCode() : null,
          expiresAt: expiresInDays === null ? null : new Date(Date.now() + expiresInDays * DAY),
          creatorId: BigInt(user.id),
        },
        select: { id: true },
      });
      return { id: share.id, file };
    });
    await this.audit.record({
      action: 'file.share',
      target: { type: 'file', id: file.id, name: file.name },
      changes: changesOf([
        ['有效期', null, expiresInDays === null ? '永久' : `${expiresInDays} 天`],
        ['提取码', null, withCode ? '有' : '无'],
      ]),
    });
    return toShare(
      await this.db.fileShare.findUniqueOrThrow({ where: { id }, select: shareSelect }),
    );
  }

  /** Revokes the link; it stops working at once. */
  async remove(user: Principal, shareId: string): Promise<void> {
    const where: Prisma.FileShareWhereInput = { id: BigInt(shareId), file: visibleFiles(user) };
    const share = await this.db.fileShare.findFirst({
      where,
      select: { file: { select: { id: true, name: true } } },
    });
    const { count } = await this.db.fileShare.deleteMany({ where });
    if (!share || count === 0) {
      throw new NotFoundException('外链不存在');
    }
    await this.audit.record({
      action: 'file.unshare',
      target: { type: 'file', id: share.file.id, name: share.file.name },
    });
  }
}
