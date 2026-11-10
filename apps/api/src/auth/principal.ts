import type { PermissionCode, TenantSummary } from '@fld/shared';
import type { SessionRecord } from '@nestjs/authentication';

/** Which rows of tenant-owned tables the user may see in the current tenant. */
export interface DataScopeGrant {
  /** Every row of the tenant; the other fields are then irrelevant. */
  all: boolean;
  /** Rows that belong to these departments. */
  deptIds: string[];
  /** Rows the user owns. */
  self: boolean;
}

/** What the user is in the tenant they currently work in. Cached in Redis, so plain JSON. */
export interface TenantContext {
  tenant: TenantSummary;
  memberId: string;
  deptId: string | null;
  permissions: PermissionCode[];
  dataScope: DataScopeGrant;
}

/** The account row as the session store reads it with each session. */
export interface SessionUser {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  mustChangePassword: boolean;
  active: boolean;
  lastTenantId: string | null;
}

export interface SessionExtraData {
  user: SessionUser | null;
  /** The tenant this sign-in switched to, if it did. */
  tenantId: string | null;
}

/** The signed-in user of a request (`@CurrentUser()`, `request.user`). */
export interface Principal {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  mustChangePassword: boolean;
  /** Null when the account belongs to no active tenant. */
  context: TenantContext | null;
  permissionSet: ReadonlySet<string>;
}

export function toPrincipal(user: SessionUser, context: TenantContext | null): Principal {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    mustChangePassword: user.mustChangePassword,
    context,
    permissionSet: new Set(context?.permissions),
  };
}

declare module '@nestjs/authentication' {
  interface AuthenticationTypes {
    user: Principal;
    session: SessionRecord;
    sessionExtra: SessionExtraData;
  }
}
