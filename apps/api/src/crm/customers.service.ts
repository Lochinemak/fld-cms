import type {
  CreateCustomerInput,
  Customer,
  CustomerQuery,
  Page,
  TransferInput,
  UpdateCustomerInput,
} from '@fld/shared';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Principal } from '../auth/principal.js';
import { TENANT_PRISMA, tenantIdOf, type TenantPrisma } from '../authz/tenant-prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import { FileRefsService } from '../files/file-refs.service.js';
import { SnowflakeService } from '../snowflake/snowflake.service.js';
import {
  lockCustomer,
  ownDept,
  requireVisibleCustomer,
  toNamedRef,
  toUserRef,
  visibleCustomers,
} from './crm-scope.js';
import { customerTarget } from './customer-attachments.service.js';
import { OwnersService } from './owners.service.js';

const customerSelect = {
  id: true,
  name: true,
  industry: true,
  source: true,
  level: true,
  status: true,
  phone: true,
  address: true,
  remark: true,
  lastFollowUpAt: true,
  nextFollowUpAt: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: { id: true, displayName: true } },
  creator: { select: { id: true, displayName: true } },
  department: { select: { id: true, name: true } },
} satisfies Prisma.CustomerSelect;

function toCustomer(row: Prisma.CustomerGetPayload<{ select: typeof customerSelect }>): Customer {
  return {
    id: row.id.toString(),
    name: row.name,
    industry: row.industry,
    source: row.source,
    level: row.level,
    status: row.status,
    phone: row.phone,
    address: row.address,
    remark: row.remark,
    owner: toUserRef(row.owner),
    dept: row.department && toNamedRef(row.department),
    creator: toUserRef(row.creator),
    lastFollowUpAt: row.lastFollowUpAt?.toISOString() ?? null,
    nextFollowUpAt: row.nextFollowUpAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Customers of the current tenant. Each has an owner and records the owner's department, and the
 * user's data scope decides which of them it sees and changes.
 */
@Injectable()
export class CustomersService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly snowflake: SnowflakeService,
    private readonly owners: OwnersService,
    private readonly refs: FileRefsService,
  ) {}

  async list(user: Principal, query: CustomerQuery): Promise<Page<Customer>> {
    const { page, pageSize, keyword, status, level, mine, dueBy } = query;
    const filters: Prisma.CustomerWhereInput[] = [visibleCustomers(user)];
    if (keyword) {
      const contains = { contains: keyword, mode: 'insensitive' } as const;
      filters.push({ OR: [{ name: contains }, { phone: contains }] });
    }
    if (status) {
      filters.push({ status });
    }
    if (level) {
      filters.push({ level });
    }
    if (mine) {
      filters.push({ ownerId: BigInt(user.id) });
    }
    if (dueBy) {
      filters.push({ nextFollowUpAt: { lte: new Date(dueBy) } });
    }
    const where = { AND: filters };
    const [rows, total] = await Promise.all([
      this.db.customer.findMany({
        where,
        select: customerSelect,
        // Customers due for a follow-up come most overdue first; otherwise the newest first.
        orderBy: dueBy ? [{ nextFollowUpAt: 'asc' }, { id: 'asc' }] : { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.customer.count({ where }),
    ]);
    return { items: rows.map(toCustomer), total };
  }

  async get(user: Principal, id: string): Promise<Customer> {
    const row = await this.db.customer.findFirst({
      where: { AND: [{ id: BigInt(id) }, visibleCustomers(user)] },
      select: customerSelect,
    });
    if (!row) {
      throw new NotFoundException('客户不存在');
    }
    return toCustomer(row);
  }

  /** The user creating a customer owns it, in the department the user is in. */
  async create(user: Principal, input: CreateCustomerInput): Promise<Customer> {
    const me = BigInt(user.id);
    const { id } = await this.db.customer.create({
      data: {
        ...input,
        id: this.snowflake.next(),
        tenantId: tenantIdOf(user),
        ownerId: me,
        creatorId: me,
        deptId: ownDept(user),
      },
      select: { id: true },
    });
    return this.read(id);
  }

  async update(user: Principal, id: string, input: UpdateCustomerInput): Promise<Customer> {
    const customerId = await requireVisibleCustomer(this.db, user, id);
    await this.db.customer.update({
      where: { id: customerId },
      data: input,
      select: { id: true },
    });
    return this.read(customerId);
  }

  /** Hands the customer to another member, into their department. Its opportunities stay put. */
  async transfer(user: Principal, id: string, { ownerId }: TransferInput): Promise<Customer> {
    const customerId = await requireVisibleCustomer(this.db, user, id);
    const owner = await this.owners.resolve(user, ownerId);
    await this.db.customer.update({
      where: { id: customerId },
      data: { ownerId: owner.userId, deptId: owner.deptId },
      select: { id: true },
    });
    return this.read(customerId);
  }

  /**
   * Deletes the customer with its contacts and follow-ups, unless it has opportunities. Its
   * attachments come off it; the files stay in the library.
   */
  async remove(user: Principal, id: string): Promise<void> {
    const customerId = await requireVisibleCustomer(this.db, user, id);
    const opportunities = await this.db.opportunity.count({ where: { customerId } });
    if (opportunities > 0) {
      throw new ConflictException(`该客户还有 ${opportunities} 个商机，不能删除`);
    }
    try {
      await this.db.$transaction(async (tx) => {
        // After any attaching under way, so that no attachment outlives the customer.
        await lockCustomer(tx, tenantIdOf(user), customerId);
        await this.refs.detachAll(tx, customerTarget(customerId));
        await tx.customer.delete({ where: { id: customerId }, select: { id: true } });
      });
    } catch (error) {
      // An opportunity added after the count above.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException('该客户还有商机，不能删除');
      }
      throw error;
    }
  }

  // Writes select only the id: selecting relations makes Prisma load them concurrently within
  // the write's implicit transaction, whose single connection would have to queue them.
  private async read(id: bigint): Promise<Customer> {
    const row = await this.db.customer.findUniqueOrThrow({
      where: { id },
      select: customerSelect,
    });
    return toCustomer(row);
  }
}
