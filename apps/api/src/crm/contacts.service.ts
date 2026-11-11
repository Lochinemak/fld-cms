import type {
  Contact,
  ContactQuery,
  CreateContactInput,
  Page,
  UpdateContactInput,
} from '@fld/shared';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { Principal } from '../auth/principal.js';
import { TENANT_PRISMA, tenantIdOf, type TenantPrisma } from '../authz/tenant-prisma.js';
import type { Prisma } from '../generated/prisma/client.js';
import { SnowflakeService } from '../snowflake/snowflake.service.js';
import { lockCustomer, requireVisibleCustomer, visibleCustomers } from './crm-scope.js';
import { toNamedRef } from '../common/refs.js';
import { customOf, CustomFieldsService } from '../custom-fields/custom-fields.service.js';

const contactSelect = {
  id: true,
  name: true,
  title: true,
  phone: true,
  email: true,
  primary: true,
  remark: true,
  createdAt: true,
  updatedAt: true,
  custom: true,
  customer: { select: { id: true, name: true } },
} satisfies Prisma.ContactSelect;

function toContact(row: Prisma.ContactGetPayload<{ select: typeof contactSelect }>): Contact {
  return {
    id: row.id.toString(),
    customer: toNamedRef(row.customer),
    name: row.name,
    title: row.title,
    phone: row.phone,
    email: row.email,
    primary: row.primary,
    remark: row.remark,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    custom: customOf(row.custom),
  };
}

/** People at customers. Whoever can see a customer can see its contacts. */
@Injectable()
export class ContactsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly snowflake: SnowflakeService,
    private readonly audit: AuditService,
    private readonly customFields: CustomFieldsService,
  ) {}

  async list(user: Principal, query: ContactQuery): Promise<Page<Contact>> {
    const { page, pageSize, keyword, customerId } = query;
    const filters: Prisma.ContactWhereInput[] = [{ customer: visibleCustomers(user) }];
    if (customerId) {
      filters.push({ customerId: BigInt(customerId) });
    }
    if (keyword) {
      const contains = { contains: keyword, mode: 'insensitive' } as const;
      filters.push({
        OR: [
          { name: contains },
          { phone: contains },
          { email: contains },
          { customer: { name: contains } },
        ],
      });
    }
    const where = { AND: filters };
    const [rows, total] = await Promise.all([
      this.db.contact.findMany({
        where,
        select: contactSelect,
        // One customer's contacts start with the primary one.
        orderBy: customerId ? [{ primary: 'desc' }, { id: 'asc' }] : { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.contact.count({ where }),
    ]);
    return { items: rows.map(toContact), total };
  }

  /** A new primary contact takes over from the customer's previous one. */
  async create(user: Principal, input: CreateContactInput): Promise<Contact> {
    const { customerId: customer, custom: given, ...fields } = input;
    const customerId = await requireVisibleCustomer(this.db, user, customer);
    const custom = await this.customFields.values('crm.contact', given, {}, { creating: true });
    const tenantId = tenantIdOf(user);
    const id = this.snowflake.next();
    await this.db.$transaction(async (tx) => {
      if (fields.primary) {
        await lockCustomer(tx, tenantId, customerId);
        await tx.contact.updateMany({
          where: { customerId, primary: true },
          data: { primary: false },
        });
      }
      await tx.contact.create({
        data: { ...fields, custom: custom as Prisma.InputJsonObject, id, tenantId, customerId },
        select: { id: true },
      });
    });
    return this.read(id);
  }

  async update(user: Principal, id: string, input: UpdateContactInput): Promise<Contact> {
    const contact = await this.findVisible(user, id);
    const { custom: given, ...fields } = input;
    const custom = await this.customFields.values('crm.contact', given, customOf(contact.custom));
    const tenantId = tenantIdOf(user);
    await this.db.$transaction(async (tx) => {
      if (fields.primary) {
        await lockCustomer(tx, tenantId, contact.customerId);
        await tx.contact.updateMany({
          where: { customerId: contact.customerId, primary: true, id: { not: contact.id } },
          data: { primary: false },
        });
      }
      await tx.contact.update({
        where: { id: contact.id },
        data: { ...fields, custom: custom as Prisma.InputJsonObject },
        select: { id: true },
      });
    });
    return this.read(contact.id);
  }

  async remove(user: Principal, id: string): Promise<void> {
    const contact = await this.findVisible(user, id);
    const { name, customer } = await this.db.contact.findUniqueOrThrow({
      where: { id: contact.id },
      select: { name: true, customer: { select: { name: true } } },
    });
    await this.db.contact.delete({ where: { id: contact.id }, select: { id: true } });
    await this.audit.record({
      action: 'contact.delete',
      target: { type: 'contact', id: contact.id, name: `${name}（${customer.name}）` },
    });
  }

  private async findVisible(user: Principal, id: string) {
    const contact = await this.db.contact.findFirst({
      where: { id: BigInt(id), customer: visibleCustomers(user) },
      select: { id: true, customerId: true, custom: true },
    });
    if (!contact) {
      throw new NotFoundException('联系人不存在');
    }
    return contact;
  }

  // Outside the transactions that write: Prisma loads relations concurrently, which a
  // transaction's single connection would have to queue.
  private async read(id: bigint): Promise<Contact> {
    const row = await this.db.contact.findUniqueOrThrow({ where: { id }, select: contactSelect });
    return toContact(row);
  }
}
