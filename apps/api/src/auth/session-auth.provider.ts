import { Injectable } from '@nestjs/common';
import {
  AuthenticationRegistry,
  SessionCookieProvider,
  type SessionRecord,
} from '@nestjs/authentication';
import { signedInWithLogto } from './logto.js';
import { toPrincipal, type Principal } from './principal.js';
import { TenantContextService } from './tenant-context.service.js';

@Injectable()
export class SessionAuth extends SessionCookieProvider<Principal> {
  constructor(
    private readonly tenantContexts: TenantContextService,
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
    const context = await this.tenantContexts.resolve(user, session.extra?.tenantId ?? null);
    // The initial password is to be replaced by whoever signs in with it. Someone who came in
    // through Logto didn't, and may never have been given it.
    const mustChangePassword = user.mustChangePassword && !signedInWithLogto(session);
    return toPrincipal({ ...user, mustChangePassword }, context);
  }
}
