import { Injectable } from '@nestjs/common';
import type { SessionRecord, SessionStore } from '@nestjs/authentication';
import type { Session } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { sessionUserSelect, toSessionUser } from './session-user.js';

const NUMERIC_ID = /^\d{1,20}$/;

/**
 * Sessions in PostgreSQL. Every write that decides an outcome (touch, delete) is one conditional
 * statement, as the store contract requires, so it holds with any number of API instances.
 */
@Injectable()
export class PrismaSessionStore implements SessionStore {
  constructor(private readonly prisma: PrismaService) {}

  async getSession(id: string): Promise<SessionRecord | undefined> {
    const row = await this.prisma.session.findUnique({ where: { id } });
    if (!row) {
      return undefined;
    }
    const user = NUMERIC_ID.test(row.userId)
      ? await this.prisma.user.findUnique({
          where: { id: BigInt(row.userId) },
          select: sessionUserSelect,
        })
      : null;
    return {
      ...toRecord(row),
      extra: { user: user && toSessionUser(user), tenantId: row.tenantId?.toString() ?? null },
    };
  }

  async createSession(record: SessionRecord): Promise<void> {
    await this.prisma.session.create({
      data: {
        id: record.id,
        userId: record.userId,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        lastActiveAt: record.lastActiveAt,
        mfa: record.mfa ?? null,
        ...(record.metadata ? { metadata: record.metadata as object } : {}),
      },
    });
    await this.prisma.session.deleteMany({ where: { expiresAt: { lte: record.createdAt } } });
  }

  async touchSession(id: string, lastActiveAt: Date): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id, lastActiveAt: { lt: lastActiveAt } },
      data: { lastActiveAt },
    });
  }

  async deleteSession(id: string): Promise<boolean> {
    const { count } = await this.prisma.session.deleteMany({ where: { id } });
    return count > 0;
  }

  async listUserSessions(userId: string): Promise<SessionRecord[]> {
    const rows = await this.prisma.session.findMany({ where: { userId } });
    return rows.map(toRecord);
  }

  async deleteUserSessions(userId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { userId } });
  }

  /** Points one sign-in at another tenant. Not part of the store contract. */
  async setSessionTenant(id: string, tenantId: bigint): Promise<void> {
    await this.prisma.session.updateMany({ where: { id }, data: { tenantId } });
  }
}

function toRecord(row: Session): SessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastActiveAt: row.lastActiveAt,
    ...(row.mfa ? { mfa: row.mfa as SessionRecord['mfa'] } : {}),
    ...(row.metadata ? { metadata: row.metadata as Record<string, unknown> } : {}),
  };
}
