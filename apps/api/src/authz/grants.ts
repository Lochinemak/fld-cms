import { grantablePermissions, type DataScope, type PermissionCode } from '@fld/shared';
import { ForbiddenException } from '@nestjs/common';
import type { Principal } from '../auth/principal.js';
import type { TenantPrisma } from './tenant-prisma.js';

/** What a role hands out, or what an edit adds to one. */
export interface Grant {
  permissions: readonly string[];
  /** Left out when the edit keeps the role's data scope. */
  dataScope?: DataScope;
  /** The departments a CUSTOM scope adds. */
  deptIds?: readonly string[];
}

/** The permissions the roles of the principal's tenant may hold. */
export function grantableIn(principal: Principal): Set<PermissionCode> {
  return new Set(principal.context ? grantablePermissions(principal.context.tenant) : []);
}

/**
 * The permissions the tenant's roles keep without holding them: those of the modules switched
 * off for it, which count again once the module is back.
 */
export function dormantIn(principal: Principal): Set<PermissionCode> {
  const tenant = principal.context?.tenant;
  if (!tenant) {
    return new Set();
  }
  const held = new Set(grantablePermissions(tenant));
  return new Set(
    grantablePermissions({ ...tenant, disabledModules: [] }).filter((code) => !held.has(code)),
  );
}

/**
 * Refuses a grant beyond the principal's own, so nobody hands out (to others, or to themselves
 * through a role they hold) more than they have: each permission must be one they hold and,
 * unless they see every row, the scope may not be ALL and custom departments must be ones they
 * see. Scopes relative to the member's own department are always allowed.
 */
export function assertWithinOwnGrant(principal: Principal, grant: Grant): void {
  if (grant.permissions.some((code) => !principal.permissionSet.has(code))) {
    throw new ForbiddenException('不能授予自己没有的权限');
  }
  const own = principal.context?.dataScope;
  if (own?.all) {
    return;
  }
  if (grant.dataScope === 'ALL') {
    throw new ForbiddenException('你的数据范围不是全部数据，不能授予全部数据');
  }
  if (grant.dataScope === 'CUSTOM') {
    const visible = new Set(own?.deptIds);
    if (grant.deptIds?.some((id) => !visible.has(id))) {
      throw new ForbiddenException('自定义数据范围只能选你自己能看到的部门');
    }
  }
}

/**
 * Refuses to hand out, with a role, permissions of a module switched off that the principal's
 * own roles don't keep: once the module is back, the role would give more than they have.
 */
export async function assertWithinDormantGrant(
  db: TenantPrisma,
  principal: Principal,
  permissions: readonly string[],
): Promise<void> {
  if (permissions.length === 0) {
    return;
  }
  const memberId = principal.context?.memberId;
  const held = memberId
    ? await db.memberRole.findMany({
        where: { memberId: BigInt(memberId) },
        select: {
          role: { select: { builtin: true, permissions: { select: { permission: true } } } },
        },
      })
    : [];
  if (held.some(({ role }) => role.builtin)) {
    return;
  }
  const kept = new Set(
    held.flatMap(({ role }) => role.permissions.map(({ permission }) => permission)),
  );
  if (permissions.some((code) => !kept.has(code))) {
    throw new ForbiddenException('不能授予自己没有的权限');
  }
}

/** Whether the principal holds a built-in administrator role in their current tenant. */
export async function holdsBuiltinRole(db: TenantPrisma, principal: Principal): Promise<boolean> {
  const memberId = principal.context?.memberId;
  if (!memberId) {
    return false;
  }
  const held = await db.memberRole.count({
    where: { memberId: BigInt(memberId), role: { builtin: true } },
  });
  return held > 0;
}
