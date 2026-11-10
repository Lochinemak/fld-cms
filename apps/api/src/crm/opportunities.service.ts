import {
  CLOSED_STAGES,
  opportunityStageSchema,
  type CreateOpportunityInput,
  type Opportunity,
  type OpportunityPage,
  type OpportunityQuery,
  type TransferInput,
  type UpdateOpportunityInput,
} from '@fld/shared';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Principal } from '../auth/principal.js';
import { TENANT_PRISMA, tenantIdOf, type TenantPrisma } from '../authz/tenant-prisma.js';
import type { Prisma } from '../generated/prisma/client.js';
import { SnowflakeService } from '../snowflake/snowflake.service.js';
import {
  ownDept,
  requireVisibleCustomer,
  toNamedRef,
  toUserRef,
  visibleOpportunities,
} from './crm-scope.js';
import { OwnersService } from './owners.service.js';

const opportunitySelect = {
  id: true,
  name: true,
  amount: true,
  expectedCloseDate: true,
  stage: true,
  remark: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { id: true, name: true } },
  owner: { select: { id: true, displayName: true } },
  department: { select: { id: true, name: true } },
} satisfies Prisma.OpportunitySelect;

function toOpportunity(
  row: Prisma.OpportunityGetPayload<{ select: typeof opportunitySelect }>,
): Opportunity {
  return {
    id: row.id.toString(),
    customer: toNamedRef(row.customer),
    name: row.name,
    amount: row.amount.toFixed(2),
    expectedCloseDate: row.expectedCloseDate?.toISOString().slice(0, 10) ?? null,
    stage: row.stage,
    owner: toUserRef(row.owner),
    dept: row.department && toNamedRef(row.department),
    remark: row.remark,
    closedAt: row.closedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** A "YYYY-MM-DD" input as the UTC midnight Prisma writes to a date column. */
function toDate(value: string | null | undefined): Date | null | undefined {
  return typeof value === 'string' ? new Date(value) : value;
}

/**
 * Possible sales to customers. Like customers they have an owner and record the owner's
 * department, which the user's data scope goes by; seeing one does not need its customer in scope.
 */
@Injectable()
export class OpportunitiesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly snowflake: SnowflakeService,
    private readonly owners: OwnersService,
  ) {}

  /** The page asked for, and every stage's count and total over all its filters but the stage. */
  async list(user: Principal, query: OpportunityQuery): Promise<OpportunityPage> {
    const { page, pageSize, keyword, stage, customerId, mine } = query;
    const filters: Prisma.OpportunityWhereInput[] = [visibleOpportunities(user)];
    if (customerId) {
      filters.push({ customerId: BigInt(customerId) });
    }
    if (mine) {
      filters.push({ ownerId: BigInt(user.id) });
    }
    if (keyword) {
      const contains = { contains: keyword, mode: 'insensitive' } as const;
      filters.push({ OR: [{ name: contains }, { customer: { name: contains } }] });
    }
    const where = { AND: stage ? [...filters, { stage }] : filters };
    const [rows, total, groups] = await Promise.all([
      this.db.opportunity.findMany({
        where,
        select: opportunitySelect,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.opportunity.count({ where }),
      this.db.opportunity.groupBy({
        by: ['stage'],
        where: { AND: filters },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);
    const stages = opportunityStageSchema.options.map((value) => {
      const group = groups.find((candidate) => candidate.stage === value);
      return {
        stage: value,
        count: group?._count._all ?? 0,
        amount: group?._sum.amount?.toFixed(2) ?? '0.00',
      };
    });
    return { items: rows.map(toOpportunity), total, stages };
  }

  /** The user creating an opportunity owns it, in the department the user is in. */
  async create(user: Principal, input: CreateOpportunityInput): Promise<Opportunity> {
    const { customerId: customer, expectedCloseDate, ...fields } = input;
    const customerId = await requireVisibleCustomer(this.db, user, customer);
    const tenantId = tenantIdOf(user);
    const id = this.snowflake.next();
    await this.db.$transaction(async (tx) => {
      await tx.opportunity.create({
        data: {
          ...fields,
          id,
          tenantId,
          customerId,
          expectedCloseDate: toDate(expectedCloseDate),
          ownerId: BigInt(user.id),
          deptId: ownDept(user),
          closedAt: CLOSED_STAGES.includes(fields.stage) ? new Date() : null,
        },
        select: { id: true },
      });
      if (fields.stage === 'WON') {
        await this.markCustomerWon(tx, customerId);
      }
    });
    return this.read(id);
  }

  /**
   * Moving into won or lost records when it closed, and reopening clears that. Winning also marks
   * the customer won; reopening leaves the customer as it is.
   */
  async update(user: Principal, id: string, input: UpdateOpportunityInput): Promise<Opportunity> {
    const current = await this.findVisible(user, id);
    const { expectedCloseDate, ...fields } = input;
    const data: Prisma.OpportunityUpdateInput = {
      ...fields,
      expectedCloseDate: toDate(expectedCloseDate),
    };
    if (input.stage && input.stage !== current.stage) {
      if (CLOSED_STAGES.includes(input.stage)) {
        data.closedAt = new Date();
      } else if (CLOSED_STAGES.includes(current.stage)) {
        data.closedAt = null;
      }
    }
    await this.db.$transaction(async (tx) => {
      await tx.opportunity.update({ where: { id: current.id }, data, select: { id: true } });
      if (input.stage === 'WON' && current.stage !== 'WON') {
        await this.markCustomerWon(tx, current.customerId);
      }
    });
    return this.read(current.id);
  }

  /** Hands the opportunity to another member, into their department. */
  async transfer(user: Principal, id: string, { ownerId }: TransferInput): Promise<Opportunity> {
    const current = await this.findVisible(user, id);
    const owner = await this.owners.resolve(user, ownerId);
    await this.db.opportunity.update({
      where: { id: current.id },
      data: { ownerId: owner.userId, deptId: owner.deptId },
      select: { id: true },
    });
    return this.read(current.id);
  }

  /** Its follow-ups stay with the customer, no longer pointing at it. */
  async remove(user: Principal, id: string): Promise<void> {
    const current = await this.findVisible(user, id);
    await this.db.opportunity.delete({ where: { id: current.id }, select: { id: true } });
  }

  private async findVisible(user: Principal, id: string) {
    const row = await this.db.opportunity.findFirst({
      where: { AND: [{ id: BigInt(id) }, visibleOpportunities(user)] },
      select: { id: true, stage: true, customerId: true },
    });
    if (!row) {
      throw new NotFoundException('商机不存在');
    }
    return row;
  }

  private async markCustomerWon(
    tx: Pick<TenantPrisma, 'customer'>,
    customerId: bigint,
  ): Promise<void> {
    await tx.customer.update({
      where: { id: customerId },
      data: { status: 'WON' },
      select: { id: true },
    });
  }

  // Outside the transactions that write: Prisma loads relations concurrently, which a
  // transaction's single connection would have to queue.
  private async read(id: bigint): Promise<Opportunity> {
    const row = await this.db.opportunity.findUniqueOrThrow({
      where: { id },
      select: opportunitySelect,
    });
    return toOpportunity(row);
  }
}
