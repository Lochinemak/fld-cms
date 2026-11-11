import { Injectable } from '@nestjs/common';
import { AuthenticationContext } from '@nestjs/authentication';
import { PrismaService } from '../prisma/prisma.service.js';
import { toPrincipal } from './principal.js';
import { sessionUserSelect, toSessionUser } from './session-user.js';
import { TenantContextService } from './tenant-context.service.js';

/** Why a job can't act for the member who asked for it any more, in words for them. */
export class RunAsRefusedError extends Error {
  override readonly name = 'RunAsRefusedError';
}

/**
 * Runs a background job's work as the member who asked for it, in the tenant they asked in: what
 * the tenant Prisma client, data scopes and audit log see is that member, as it is now, not as it
 * was when the job was queued.
 */
@Injectable()
export class RunAsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContexts: TenantContextService,
    private readonly auth: AuthenticationContext,
  ) {}

  async run<R>(userId: bigint, tenantId: bigint, work: () => Promise<R>): Promise<R> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: sessionUserSelect,
    });
    if (!row || row.status !== 'ACTIVE') {
      throw new RunAsRefusedError('账号已停用');
    }
    const context = await this.tenantContexts.load(userId, tenantId);
    if (!context) {
      throw new RunAsRefusedError('你已不是该租户的成员，或租户已停用');
    }
    return this.auth.run({ user: toPrincipal(toSessionUser(row), context) }, work);
  }
}
