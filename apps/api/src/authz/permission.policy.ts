import type { PermissionCode } from '@fld/shared';
import { Can, Policy } from '@nestjs/authorization';
import type { Principal } from '../auth/principal.js';

@Policy()
export class PermissionPolicy {
  /** Whether the user holds the permission in their current tenant. */
  has(user: Principal | null, code: PermissionCode): boolean {
    // Until the initial password is replaced, the account may only manage itself.
    return user !== null && !user.mustChangePassword && user.permissionSet.has(code);
  }
}

/** Allows the route to members of the current tenant who hold the permission. */
export const RequirePermission = (code: PermissionCode) =>
  Can(PermissionPolicy, 'has', () => [code] as const);
