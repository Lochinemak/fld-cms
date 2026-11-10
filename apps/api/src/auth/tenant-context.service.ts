import {
  grantablePermissions,
  isPermissionCode,
  SYSTEM_TENANT_ID,
  type PermissionCode,
  type TenantSummary,
} from '@fld/shared';
import { Injectable } from '@nestjs/common';
import type { DataScope } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { DataScopeGrant, SessionUser, TenantContext } from './principal.js';
import { TenantContextCache } from './tenant-context.cache.js';

const SYSTEM_TENANT = BigInt(SYSTEM_TENANT_ID);

interface RoleGrant {
  builtin: boolean;
  dataScope: DataScope;
  permissions: { permission: string }[];
  departments: { deptId: bigint }[];
}

export function toTenantSummary(tenant: { id: bigint; code: string; name: string }): TenantSummary {
  const id = tenant.id.toString();
  return { id, code: tenant.code, name: tenant.name, isSystem: id === SYSTEM_TENANT_ID };
}

@Injectable()
export class TenantContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: TenantContextCache,
  ) {}

  /** The user's context in the tenant, or null when they may not work there. */
  load(userId: bigint, tenantId: bigint): Promise<TenantContext | null> {
    return this.cache.getOrLoad(tenantId, userId, () => this.compute(userId, tenantId));
  }

  /** The tenant a sign-in works in: the one it switched to, the last one used, or the first joined. */
  async resolve(user: SessionUser, sessionTenantId: string | null): Promise<TenantContext | null> {
    const userId = BigInt(user.id);
    for (const candidate of new Set([sessionTenantId, user.lastTenantId])) {
      const context = candidate ? await this.load(userId, BigInt(candidate)) : null;
      if (context) {
        return context;
      }
    }
    const [first] = await this.listTenants(userId);
    return first ? this.load(userId, BigInt(first.id)) : null;
  }

  /** The active tenants the user may switch to. */
  async listTenants(userId: bigint): Promise<TenantSummary[]> {
    const platform = await this.isPlatformAccount(userId);
    const memberships = await this.prisma.tenantMember.findMany({
      where: {
        userId,
        status: 'ACTIVE',
        tenant: { status: 'ACTIVE' },
        ...(platform ? { tenantId: SYSTEM_TENANT } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: { tenant: { select: { id: true, code: true, name: true } } },
    });
    return memberships.map(({ tenant }) => toTenantSummary(tenant));
  }

  /** Members of the system tenant manage tenants from there and never work inside another one. */
  private async isPlatformAccount(userId: bigint): Promise<boolean> {
    return (
      (await this.prisma.tenantMember.count({ where: { tenantId: SYSTEM_TENANT, userId } })) > 0
    );
  }

  private async compute(userId: bigint, tenantId: bigint): Promise<TenantContext | null> {
    if (tenantId !== SYSTEM_TENANT && (await this.isPlatformAccount(userId))) {
      return null;
    }
    const member = await this.prisma.tenantMember.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      select: {
        id: true,
        status: true,
        deptId: true,
        tenant: { select: { id: true, code: true, name: true, status: true } },
        department: { select: { path: true } },
        roles: {
          select: {
            role: {
              select: {
                builtin: true,
                dataScope: true,
                permissions: { select: { permission: true } },
                departments: { select: { deptId: true } },
              },
            },
          },
        },
      },
    });
    if (!member || member.status !== 'ACTIVE' || member.tenant.status !== 'ACTIVE') {
      return null;
    }
    const tenant = toTenantSummary(member.tenant);
    const roles = member.roles.map(({ role }) => role);
    return {
      tenant,
      memberId: member.id.toString(),
      deptId: member.deptId?.toString() ?? null,
      permissions: effectivePermissions(roles, tenant.isSystem),
      dataScope: await this.dataScope(tenantId, roles, member.deptId, member.department?.path),
    };
  }

  private async dataScope(
    tenantId: bigint,
    roles: RoleGrant[],
    deptId: bigint | null,
    deptPath: string | undefined,
  ): Promise<DataScopeGrant> {
    const scopes = new Set(roles.map((role) => (role.builtin ? 'ALL' : role.dataScope)));
    if (scopes.has('ALL')) {
      return { all: true, deptIds: [], self: true };
    }
    const deptIds = new Set<bigint>();
    if (deptId !== null) {
      if (scopes.has('DEPT')) {
        deptIds.add(deptId);
      }
      if (scopes.has('DEPT_AND_CHILDREN') && deptPath) {
        const subtree = await this.prisma.department.findMany({
          where: { tenantId, path: { startsWith: deptPath } },
          select: { id: true },
        });
        subtree.forEach(({ id }) => deptIds.add(id));
      }
    }
    for (const role of roles) {
      if (role.dataScope === 'CUSTOM') {
        role.departments.forEach(({ deptId: id }) => deptIds.add(id));
      }
    }
    // Everyone sees the rows they own, whatever their roles grant on top.
    return { all: false, deptIds: [...deptIds].map(String).sort(), self: true };
  }
}

function effectivePermissions(roles: RoleGrant[], isSystemTenant: boolean): PermissionCode[] {
  const grantable = new Set(grantablePermissions(isSystemTenant));
  const granted = new Set<PermissionCode>();
  for (const role of roles) {
    if (role.builtin) {
      grantable.forEach((code) => granted.add(code));
      continue;
    }
    for (const { permission } of role.permissions) {
      if (isPermissionCode(permission) && grantable.has(permission)) {
        granted.add(permission);
      }
    }
  }
  return [...granted].sort();
}
