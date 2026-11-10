import type { Prisma } from '../generated/prisma/client.js';

export interface TenantSeed {
  id: bigint;
  code: string;
  name: string;
  /** The built-in role of the tenant's first administrator. */
  adminRole: { code: string; name: string };
  /** The existing user who becomes that administrator. */
  adminUserId: bigint;
}

/**
 * Creates a tenant with its root department, its built-in administrator role, and the
 * administrator's membership. Run it in the transaction that creates the administrator.
 */
export async function seedTenant(
  tx: Prisma.TransactionClient,
  nextId: () => bigint,
  seed: TenantSeed,
): Promise<void> {
  const tenantId = seed.id;
  const deptId = nextId();
  const roleId = nextId();
  const memberId = nextId();
  await tx.tenant.create({ data: { id: tenantId, code: seed.code, name: seed.name } });
  await tx.department.create({
    data: { id: deptId, tenantId, name: seed.name, path: `/${deptId}/` },
  });
  await tx.role.create({
    data: { id: roleId, tenantId, ...seed.adminRole, builtin: true, dataScope: 'ALL' },
  });
  await tx.tenantMember.create({
    data: { id: memberId, tenantId, userId: seed.adminUserId, deptId },
  });
  await tx.memberRole.create({ data: { tenantId, memberId, roleId } });
}
