import type { DataScope } from '@fld/shared';
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
