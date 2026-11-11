import type { Notification, NotificationPage, NotificationQuery } from '@fld/shared';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Principal } from '../auth/principal.js';
import { TENANT_PRISMA, type TenantPrisma } from '../authz/tenant-prisma.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SnowflakeService } from '../snowflake/snowflake.service.js';

/** Days a notification is kept, read or not. */
export const NOTIFICATION_KEEP_DAYS = 90;

export interface NewNotification {
  tenantId: bigint | string;
  userId: bigint | string;
  kind: string;
  title: string;
  body?: string | null;
  link?: string | null;
}

const notificationSelect = {
  id: true,
  kind: true,
  title: true,
  body: true,
  link: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

function toNotification(
  row: Prisma.NotificationGetPayload<{ select: typeof notificationSelect }>,
): Notification {
  return {
    id: row.id.toString(),
    kind: row.kind,
    title: row.title,
    body: row.body,
    link: row.link,
    read: row.readAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Messages to members, each in one tenant: what a background job finished, what someone handed
 * them. Anything may `notify()`; each member reads and marks their own.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly prisma: PrismaService,
    private readonly snowflake: SnowflakeService,
  ) {}

  /**
   * Leaves a message for the member, in the tenant named, whoever the current user is: jobs run
   * with nobody signed in.
   */
  async notify(notification: NewNotification): Promise<void> {
    await this.prisma.notification.create({
      data: {
        id: this.snowflake.next(),
        tenantId: BigInt(notification.tenantId),
        userId: BigInt(notification.userId),
        kind: notification.kind,
        title: notification.title.slice(0, 200),
        body: notification.body?.slice(0, 1000) ?? null,
        link: notification.link ?? null,
      },
      select: { id: true },
    });
  }

  async list(user: Principal, query: NotificationQuery): Promise<NotificationPage> {
    const mine = { userId: BigInt(user.id) };
    const where = query.unreadOnly ? { ...mine, readAt: null } : mine;
    const [rows, total, unread] = await Promise.all([
      this.db.notification.findMany({
        where,
        select: notificationSelect,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.notification.count({ where }),
      this.unread(user),
    ]);
    return { items: rows.map(toNotification), total, unread };
  }

  unread(user: Principal): Promise<number> {
    return this.db.notification.count({ where: { userId: BigInt(user.id), readAt: null } });
  }

  async markRead(user: Principal, id: string): Promise<void> {
    const { count } = await this.db.notification.updateMany({
      where: { id: BigInt(id), userId: BigInt(user.id) },
      data: { readAt: new Date() },
    });
    if (count === 0) {
      throw new NotFoundException('通知不存在');
    }
  }

  async markAllRead(user: Principal): Promise<void> {
    await this.db.notification.updateMany({
      where: { userId: BigInt(user.id), readAt: null },
      data: { readAt: new Date() },
    });
  }

  /** Removes what is older than NOTIFICATION_KEEP_DAYS before `now`, in every tenant. */
  async removeExpired(now = new Date()): Promise<number> {
    const { count } = await this.prisma.notification.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - NOTIFICATION_KEEP_DAYS * 86_400_000) } },
    });
    return count;
  }
}
