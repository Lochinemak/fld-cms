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

  /** Whether the user holds at least one of the permissions in their current tenant. */
  hasAny(user: Principal | null, ...codes: PermissionCode[]): boolean {
    return codes.some((code) => this.has(user, code));
  }
}

/** Allows the route to members of the current tenant who hold the permission. */
export const RequirePermission = (code: PermissionCode) =>
  Can(PermissionPolicy, 'has', () => [code] as const);

/**
 * Allows the route to members who hold any of the permissions: for lists that several pages
 * read, such as the departments a member form picks from.
 */
export const RequireAnyPermission = (...codes: PermissionCode[]) =>
  Can(PermissionPolicy, 'hasAny', () => codes);
