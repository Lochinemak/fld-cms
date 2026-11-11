import { ForbiddenException } from '@nestjs/common';
import type { AuthenticationContext } from '@nestjs/authentication';
import type { Principal } from '../auth/principal.js';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/** Models whose rows belong to one tenant through their tenant_id column. */
export const TENANT_MODELS: ReadonlySet<string> = new Set([
  'TenantMember',
  'Department',
  'Role',
  'MemberRole',
  'RoleDepartment',
  'Customer',
  'Contact',
  'FollowUp',
  'Opportunity',
  'FileFolder',
  'StoredFile',
  'FileVersion',
  'FileShare',
  'FileRef',
  'Dictionary',
  'DictionaryItem',
  'CustomField',
  'Notification',
  'SpreadsheetTask',
]);

const FILTERED = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);
const CREATES = new Set(['create', 'createMany', 'createManyAndReturn']);
const UPDATES = new Set(['update', 'updateMany', 'updateManyAndReturn']);

type Args = Record<string, unknown>;

function namesOtherTenant(row: Args, tenantId: bigint): boolean {
  return 'tenant' in row || (row['tenantId'] !== undefined && row['tenantId'] !== tenantId);
}

function createdIn(tenantId: bigint, data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.map((row) => createdIn(tenantId, row));
  }
  if (typeof data !== 'object' || data === null) {
    return data;
  }
  if (namesOtherTenant(data as Args, tenantId)) {
    throw new Error('Rows of a tenant model can only be created in the current tenant.');
  }
  return { ...data, tenantId };
}

function keptIn(tenantId: bigint, data: unknown): unknown {
  if (typeof data === 'object' && data !== null && namesOtherTenant(data as Args, tenantId)) {
    throw new Error('Rows of a tenant model cannot move to another tenant.');
  }
  return data;
}

/**
 * The arguments of a query on a tenant model, limited to one tenant: reads, updates and deletes
 * only match its rows, and creates land in it. Relation filters and nested writes are not
 * rewritten; write those with explicit tenant ids.
 */
export function scopeToTenant(operation: string, args: Args | undefined, tenantId: bigint): Args {
  const scoped: Args = { ...args };
  if (FILTERED.has(operation)) {
    scoped.where = { ...(scoped.where as Args | undefined), tenantId };
  }
  if (CREATES.has(operation)) {
    scoped.data = createdIn(tenantId, scoped.data);
  }
  if (UPDATES.has(operation)) {
    scoped.data = keptIn(tenantId, scoped.data);
  }
  if (operation === 'upsert') {
    scoped.create = createdIn(tenantId, scoped.create);
    scoped.update = keptIn(tenantId, scoped.update);
  }
  return scoped;
}

export function tenantScope(currentTenantId: () => bigint) {
  return Prisma.defineExtension({
    name: 'tenant-scope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) {
            return query(args);
          }
          return query(scopeToTenant(operation, args as Args, currentTenantId()) as typeof args);
        },
      },
    },
  });
}

/** The id of the tenant the user currently works in. */
export function tenantIdOf(user: Principal): bigint {
  const tenant = user.context?.tenant;
  if (!tenant) {
    throw new ForbiddenException('你还不是任何租户的成员');
  }
  return BigInt(tenant.id);
}

/** Injection token of the Prisma client limited to the signed-in user's current tenant. */
export const TENANT_PRISMA = Symbol('TENANT_PRISMA');

export function createTenantPrisma(prisma: PrismaService, auth: AuthenticationContext) {
  return prisma.$extends(tenantScope(() => tenantIdOf(auth.requireUser())));
}

export type TenantPrisma = ReturnType<typeof createTenantPrisma>;
