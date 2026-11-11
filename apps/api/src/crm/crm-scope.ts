import { NotFoundException } from '@nestjs/common';
import type { Principal } from '../auth/principal.js';
import { dataScopeWhere } from '../authz/data-scope.js';
import type { TenantPrisma } from '../authz/tenant-prisma.js';
import type { Prisma } from '../generated/prisma/client.js';

export type RawExecutor = Pick<Prisma.TransactionClient, '$executeRaw'>;

/** Customers the user's data scope covers, by their department or as their owner. */
export function visibleCustomers(user: Principal): Prisma.CustomerWhereInput {
  return dataScopeWhere<Prisma.CustomerWhereInput>(user, { dept: 'deptId', owner: 'ownerId' });
}

/** Opportunities the user's data scope covers, judged by their own owner and department. */
export function visibleOpportunities(user: Principal): Prisma.OpportunityWhereInput {
  return dataScopeWhere<Prisma.OpportunityWhereInput>(user, { dept: 'deptId', owner: 'ownerId' });
}

/** The id of a customer the user can see; one it cannot see is a 404, as if it did not exist. */
export async function requireVisibleCustomer(
  db: TenantPrisma,
  user: Principal,
  id: string,
): Promise<bigint> {
  const customer = await db.customer.findFirst({
    where: { AND: [{ id: BigInt(id) }, visibleCustomers(user)] },
    select: { id: true },
  });
  if (!customer) {
    throw new NotFoundException('客户不存在');
  }
  return customer.id;
}

/**
 * Holds the customer's row until the transaction ends, so that changes deriving something from
 * all of its rows (its latest follow-up, its one primary contact) happen one at a time.
 */
export async function lockCustomer(
  tx: RawExecutor,
  tenantId: bigint,
  customerId: bigint,
): Promise<void> {
  await tx.$executeRaw`
    SELECT 1 FROM customers WHERE tenant_id = ${tenantId} AND id = ${customerId} FOR UPDATE`;
}
