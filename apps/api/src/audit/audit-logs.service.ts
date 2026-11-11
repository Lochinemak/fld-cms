import {
  SYSTEM_TENANT_ID,
  type AuditAction,
  type AuditChange,
  type AuditLog,
  type AuditLogQuery,
  type AuditTargetType,
  type Page,
} from '@fld/shared';
import { Injectable } from '@nestjs/common';
import type { Principal } from '../auth/principal.js';
import { tenantIdOf } from '../authz/tenant-prisma.js';
import type { AuditLog as AuditLogRow, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const SYSTEM_TENANT = BigInt(SYSTEM_TENANT_ID);

function toAuditLog(row: AuditLogRow): AuditLog {
  return {
    id: row.id.toString(),
    createdAt: row.createdAt.toISOString(),
    actor:
      row.actorUsername === null
        ? null
        : {
            id: row.actorId?.toString() ?? null,
            username: row.actorUsername,
            displayName: row.actorName ?? '',
          },
    action: row.action as AuditAction,
    target:
      row.targetType === null
        ? null
        : {
            type: row.targetType as AuditTargetType,
            id: row.targetId?.toString() ?? null,
            name: row.targetName ?? '',
          },
    success: row.success,
    reason: row.reason,
    changes: (row.changes as AuditChange[] | null) ?? [],
    ip: row.ip,
    userAgent: row.userAgent,
    requestId: row.requestId,
  };
}

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The audit records the current tenant sees, newest first: its own, and those of its members'
   * accounts. The system tenant also sees attempts that named no account.
   */
  async list(user: Principal, query: AuditLogQuery): Promise<Page<AuditLog>> {
    const tenantId = tenantIdOf(user);
    const members = await this.prisma.tenantMember.findMany({
      where: { tenantId },
      select: { userId: true },
    });
    const visible: Prisma.AuditLogWhereInput[] = [
      { tenantId },
      { tenantId: null, accountId: { in: members.map((member) => member.userId) } },
    ];
    if (tenantId === SYSTEM_TENANT) {
      visible.push({ tenantId: null, accountId: null });
    }
    const filters: Prisma.AuditLogWhereInput[] = [{ OR: visible }];
    if (query.from || query.to) {
      filters.push({
        createdAt: {
          ...(query.from ? { gte: new Date(query.from) } : {}),
          ...(query.to ? { lt: new Date(query.to) } : {}),
        },
      });
    }
    if (query.actor) {
      filters.push({
        OR: [
          { actorUsername: { contains: query.actor, mode: 'insensitive' } },
          { actorName: { contains: query.actor, mode: 'insensitive' } },
        ],
      });
    }
    if (query.action) {
      filters.push({ action: query.action });
    }
    if (query.keyword) {
      filters.push({ targetName: { contains: query.keyword, mode: 'insensitive' } });
    }
    const where: Prisma.AuditLogWhereInput = { AND: filters };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items: rows.map(toAuditLog), total };
  }
}
