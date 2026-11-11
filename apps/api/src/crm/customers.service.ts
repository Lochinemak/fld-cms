import type {
  CreateCustomerInput,
  Customer,
  CustomerQuery,
  CustomValues,
  Page,
  TransferInput,
  UpdateCustomerInput,
} from '@fld/shared';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AuditService, changesOf } from '../audit/audit.service.js';
import type { Principal } from '../auth/principal.js';
import { TENANT_PRISMA, tenantIdOf, type TenantPrisma } from '../authz/tenant-prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import { FileRefsService } from '../files/file-refs.service.js';
import { SnowflakeService } from '../snowflake/snowflake.service.js';
import { lockCustomer, requireVisibleCustomer, visibleCustomers } from './crm-scope.js';
import { toNamedRef, toUserRef } from '../common/refs.js';
import { ownDept } from '../authz/data-scope.js';
import { customerTarget } from './customer-attachments.service.js';
import { OwnersService } from './owners.service.js';
import { customOf, CustomFieldsService } from '../custom-fields/custom-fields.service.js';
import { DictionariesService } from '../custom-fields/dictionaries.service.js';

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
  custom: true,
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
    custom: customOf(row.custom),
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
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly customFields: CustomFieldsService,
    private readonly dictionaries: DictionariesService,
  ) {}

  async list(user: Principal, query: CustomerQuery): Promise<Page<Customer>> {
    const { page, pageSize, dueBy } = query;
    const where = this.where(user, query);
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

  /**
   * Every customer the list shows for the query, newest first, a batch at a time: what an export
   * writes.
   */
  async *each(user: Principal, query: CustomerQuery, batch = 500): AsyncGenerator<Customer[]> {
    const where = this.where(user, query);
    let before: bigint | undefined;
    for (;;) {
      const rows = await this.db.customer.findMany({
        where: before === undefined ? where : { AND: [where, { id: { lt: before } }] },
        select: customerSelect,
        orderBy: { id: 'desc' },
        take: batch,
      });
      if (rows.length === 0) {
        return;
      }
      yield rows.map(toCustomer);
      before = rows[rows.length - 1]!.id;
    }
  }

  /**
   * Creates customers that were checked already, as an import does: all of them or, on any
   * failure, none. The user owns them, in their department.
   */
  async createChecked(
    user: Principal,
    inputs: (CreateCustomerInput & { custom: CustomValues })[],
  ): Promise<number> {
    const me = BigInt(user.id);
    const tenantId = tenantIdOf(user);
    const deptId = ownDept(user);
    const { count } = await this.db.customer.createMany({
      data: inputs.map((input) => ({
        ...input,
        custom: input.custom as Prisma.InputJsonObject,
        id: this.snowflake.next(),
        tenantId,
        ownerId: me,
        creatorId: me,
        deptId,
      })),
    });
    return count;
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
  /** What the list filters by, within the user's data scope. */
  private where(user: Principal, query: CustomerQuery): Prisma.CustomerWhereInput {
    const { keyword, status, level, mine, dueBy } = query;
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
    return { AND: filters };
  }

  async create(user: Principal, input: CreateCustomerInput): Promise<Customer> {
    const me = BigInt(user.id);
    const { custom: given, ...fields } = input;
    await this.dictionaries.assertValue(user, 'crm.customer-source', fields.source);
    const custom = await this.customFields.values('crm.customer', given, {}, { creating: true });
    const { id } = await this.db.customer.create({
      data: {
        ...fields,
        custom: custom as Prisma.InputJsonObject,
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
    const stored = await this.db.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: { source: true, custom: true },
    });
    const { custom: given, ...fields } = input;
    await this.dictionaries.assertValue(user, 'crm.customer-source', fields.source, stored.source);
    const custom = await this.customFields.values('crm.customer', given, customOf(stored.custom));
    await this.db.customer.update({
      where: { id: customerId },
      data: { ...fields, custom: custom as Prisma.InputJsonObject },
      select: { id: true },
    });
    return this.read(customerId);
  }

  /** Hands the customer to another member, into their department. Its opportunities stay put. */
  async transfer(user: Principal, id: string, { ownerId }: TransferInput): Promise<Customer> {
    const customerId = await requireVisibleCustomer(this.db, user, id);
    const owner = await this.owners.resolve(user, ownerId);
    const before = await this.read(customerId);
    await this.db.customer.update({
      where: { id: customerId },
      data: { ownerId: owner.userId, deptId: owner.deptId },
      select: { id: true },
    });
    const after = await this.read(customerId);
    await this.audit.record({
      action: 'customer.transfer',
      target: { type: 'customer', id: after.id, name: after.name },
      changes: changesOf([
        ['负责人', before.owner.displayName, after.owner.displayName],
        ['所属部门', before.dept?.name, after.dept?.name],
      ]),
    });
    // Told unless they handed it to themselves.
    if (owner.userId.toString() !== user.id) {
      await this.notifications.notify({
        tenantId: tenantIdOf(user),
        userId: owner.userId,
        kind: 'transfer',
        title: `${user.displayName} 把客户「${after.name}」转给了你`,
        link: `/crm/customers/${after.id}`,
      });
    }
    return after;
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
    const { name } = await this.db.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: { name: true },
    });
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
    await this.audit.record({
      action: 'customer.delete',
      target: { type: 'customer', id: customerId, name },
    });
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
