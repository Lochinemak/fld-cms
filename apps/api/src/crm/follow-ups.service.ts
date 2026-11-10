import type { CreateFollowUpInput, FollowUp, FollowUpQuery, Page } from '@fld/shared';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService, changesOf } from '../audit/audit.service.js';
import type { Principal } from '../auth/principal.js';
import { TENANT_PRISMA, tenantIdOf, type TenantPrisma } from '../authz/tenant-prisma.js';
import type { Prisma } from '../generated/prisma/client.js';
import { SnowflakeService } from '../snowflake/snowflake.service.js';
import {
  lockCustomer,
  requireVisibleCustomer,
  toNamedRef,
  toUserRef,
  visibleCustomers,
  type RawExecutor,
} from './crm-scope.js';

const followUpSelect = {
  id: true,
  method: true,
  content: true,
  followedAt: true,
  nextAt: true,
  createdAt: true,
  customer: { select: { id: true, name: true } },
  contact: { select: { id: true, name: true } },
  opportunity: { select: { id: true, name: true } },
  author: { select: { id: true, displayName: true } },
} satisfies Prisma.FollowUpSelect;

function toFollowUp(row: Prisma.FollowUpGetPayload<{ select: typeof followUpSelect }>): FollowUp {
  return {
    id: row.id.toString(),
    customer: toNamedRef(row.customer),
    contact: row.contact && toNamedRef(row.contact),
    opportunity: row.opportunity && toNamedRef(row.opportunity),
    method: row.method,
    content: row.content,
    followedAt: row.followedAt.toISOString(),
    nextAt: row.nextAt?.toISOString() ?? null,
    author: toUserRef(row.author),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Copies the times of the customer's latest follow-up onto it, or clears them when none is left. */
function syncFollowUpTimes(tx: RawExecutor, tenantId: bigint, customerId: bigint) {
  // A sub-select returning no row sets both columns to null.
  return tx.$executeRaw`
    UPDATE customers SET (last_follow_up_at, next_follow_up_at) = (
      SELECT followed_at, next_at FROM follow_ups
      WHERE tenant_id = ${tenantId} AND customer_id = ${customerId}
      ORDER BY followed_at DESC, id DESC
      LIMIT 1
    )
    WHERE tenant_id = ${tenantId} AND id = ${customerId}`;
}

/**
 * Records of reaching out to customers. Whoever can see a customer can see its follow-ups; they
 * are written once and never edited.
 */
@Injectable()
export class FollowUpsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly snowflake: SnowflakeService,
    private readonly audit: AuditService,
  ) {}

  async list(user: Principal, query: FollowUpQuery): Promise<Page<FollowUp>> {
    const { page, pageSize, keyword, customerId, opportunityId, mine } = query;
    const filters: Prisma.FollowUpWhereInput[] = [{ customer: visibleCustomers(user) }];
    if (customerId) {
      filters.push({ customerId: BigInt(customerId) });
    }
    if (opportunityId) {
      filters.push({ opportunityId: BigInt(opportunityId) });
    }
    if (mine) {
      filters.push({ authorId: BigInt(user.id) });
    }
    if (keyword) {
      const contains = { contains: keyword, mode: 'insensitive' } as const;
      filters.push({ OR: [{ content: contains }, { customer: { name: contains } }] });
    }
    const where = { AND: filters };
    const [rows, total] = await Promise.all([
      this.db.followUp.findMany({
        where,
        select: followUpSelect,
        orderBy: [{ followedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.followUp.count({ where }),
    ]);
    return { items: rows.map(toFollowUp), total };
  }

  async create(user: Principal, input: CreateFollowUpInput): Promise<FollowUp> {
    const customerId = await requireVisibleCustomer(this.db, user, input.customerId);
    const contactId = input.contactId ? BigInt(input.contactId) : null;
    const opportunityId = input.opportunityId ? BigInt(input.opportunityId) : null;
    if (
      contactId !== null &&
      !(await this.db.contact.count({ where: { id: contactId, customerId } }))
    ) {
      throw new BadRequestException('联系人不属于该客户');
    }
    if (
      opportunityId !== null &&
      !(await this.db.opportunity.count({ where: { id: opportunityId, customerId } }))
    ) {
      throw new BadRequestException('商机不属于该客户');
    }
    const tenantId = tenantIdOf(user);
    const id = this.snowflake.next();
    await this.db.$transaction(async (tx) => {
      await lockCustomer(tx, tenantId, customerId);
      await tx.followUp.create({
        data: {
          id,
          tenantId,
          customerId,
          contactId,
          opportunityId,
          method: input.method,
          content: input.content,
          followedAt: input.followedAt ? new Date(input.followedAt) : new Date(),
          nextAt: input.nextAt ? new Date(input.nextAt) : null,
          authorId: BigInt(user.id),
        },
        select: { id: true },
      });
      await syncFollowUpTimes(tx, tenantId, customerId);
    });
    const row = await this.db.followUp.findUniqueOrThrow({
      where: { id },
      select: followUpSelect,
    });
    return toFollowUp(row);
  }

  async remove(user: Principal, id: string): Promise<void> {
    const followUp = await this.db.followUp.findFirst({
      where: { id: BigInt(id), customer: visibleCustomers(user) },
      select: { id: true, customerId: true, content: true, customer: { select: { name: true } } },
    });
    if (!followUp) {
      throw new NotFoundException('跟进记录不存在');
    }
    const tenantId = tenantIdOf(user);
    await this.db.$transaction(async (tx) => {
      await lockCustomer(tx, tenantId, followUp.customerId);
      await tx.followUp.delete({ where: { id: followUp.id }, select: { id: true } });
      await syncFollowUpTimes(tx, tenantId, followUp.customerId);
    });
    const content = followUp.content;
    await this.audit.record({
      action: 'follow-up.delete',
      target: { type: 'follow-up', id: followUp.id, name: followUp.customer.name },
      changes: changesOf([
        ['内容', content.length > 100 ? `${content.slice(0, 100)}…` : content, null],
      ]),
    });
  }
}
