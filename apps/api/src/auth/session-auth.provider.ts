import { Injectable } from '@nestjs/common';
import {
  AuthenticationRegistry,
  SessionCookieProvider,
  type SessionRecord,
} from '@nestjs/authentication';
import { signedInWithLogto } from './logto.js';
import { PrismaSessionStore } from './prisma-session.store.js';
import { toPrincipal, type Principal } from './principal.js';
import { TenantContextService } from './tenant-context.service.js';

@Injectable()
export class SessionAuth extends SessionCookieProvider<Principal> {
  constructor(
    private readonly tenantContexts: TenantContextService,
    private readonly sessionStore: PrismaSessionStore,
    registry: AuthenticationRegistry,
  ) {
    super();
    registry.registerProvider(this);
  }

  // Runs on every request with a live session cookie; returning null ends the session.
  protected async validate(session: SessionRecord): Promise<Principal | null> {
    const user = session.extra?.user;
    if (!user?.active) {
      return null;
    }
    const sessionTenantId = session.extra?.tenantId ?? null;
    const context = await this.tenantContexts.resolve(user, sessionTenantId);
    // Pin the tenant the sign-in fell back to, so later requests find it in the cache at once
    // instead of listing the account's tenants again every time.
    if (context && context.tenant.id !== sessionTenantId) {
      await this.sessionStore.setSessionTenant(session.id, BigInt(context.tenant.id));
    }
    // The initial password is to be replaced by whoever signs in with it. Someone who came in
    // through Logto didn't, and may never have been given it.
    const mustChangePassword = user.mustChangePassword && !signedInWithLogto(session);
    return toPrincipal({ ...user, mustChangePassword }, context);
  }
}
