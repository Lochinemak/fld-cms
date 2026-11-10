import type { ChangePasswordInput, Me } from '@fld/shared';
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { SessionService, SignInService, type SessionRecord } from '@nestjs/authentication';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CredentialsService } from './credentials.service.js';
import { PrismaSessionStore } from './prisma-session.store.js';
import { toPrincipal, type Principal } from './principal.js';
import { sessionUserSelect, toSessionUser } from './session-user.js';
import { TenantContextService } from './tenant-context.service.js';

@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
    private readonly tenantContexts: TenantContextService,
    private readonly sessionStore: PrismaSessionStore,
    private readonly sessions: SessionService,
    private readonly signIn: SignInService,
    private readonly audit: AuditService,
  ) {}

  async describe(principal: Principal): Promise<Me> {
    return {
      user: {
        id: principal.id,
        username: principal.username,
        email: principal.email,
        displayName: principal.displayName,
        mustChangePassword: principal.mustChangePassword,
      },
      tenant: principal.context?.tenant ?? null,
      tenants: await this.tenantContexts.listTenants(BigInt(principal.id)),
      permissions: principal.context?.permissions ?? [],
    };
  }

  /** For a sign-in, whose request carried no session yet: where a new session of the user lands. */
  async describeUser(userId: string): Promise<Me> {
    const row = await this.prisma.user.findUniqueOrThrow({
      where: { id: BigInt(userId) },
      select: sessionUserSelect,
    });
    const user = toSessionUser(row);
    return this.describe(toPrincipal(user, await this.tenantContexts.resolve(user, null)));
  }

  async recordSignIn(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: BigInt(userId) },
      data: { lastSignInAt: new Date() },
    });
  }

  /** Moves this sign-in to another tenant, which the next sign-in will start in too. */
  async switchTenant(principal: Principal, session: SessionRecord, tenantId: string): Promise<Me> {
    const userId = BigInt(principal.id);
    const context = await this.tenantContexts.load(userId, BigInt(tenantId));
    if (!context) {
      throw new ForbiddenException('你不是该租户的成员，或该租户已停用');
    }
    await this.sessionStore.setSessionTenant(session.id, BigInt(tenantId));
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastTenantId: BigInt(tenantId) },
    });
    // Recorded in the tenant entered only, which the tenant left doesn't need to know.
    await this.audit.record({
      action: 'auth.switch-tenant',
      tenantId,
      target: { type: 'tenant', id: tenantId, name: context.tenant.name },
    });
    return this.describe({ ...principal, context, permissionSet: new Set(context.permissions) });
  }

  /** Sets a new password, keeps this browser signed in under a new session id, and signs out every other one. */
  async changePassword(principal: Principal, input: ChangePasswordInput): Promise<Me> {
    const userId = BigInt(principal.id);
    if (!(await this.credentials.check(userId, input.currentPassword))) {
      await this.audit.record({
        action: 'auth.change-password',
        account: principal,
        success: false,
        reason: '当前密码不正确',
      });
      throw new BadRequestException('当前密码不正确');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await this.credentials.hash(input.newPassword),
        mustChangePassword: false,
      },
    });
    const rotated = await this.signIn.rotateSession();
    if (rotated && principal.context) {
      await this.sessionStore.setSessionTenant(
        rotated.session.id,
        BigInt(principal.context.tenant.id),
      );
    }
    await this.sessions.revokeAll(principal.id, { except: rotated?.session.id });
    await this.audit.record({ action: 'auth.change-password', account: principal });
    return this.describe({ ...principal, mustChangePassword: false });
  }
}
