import type { Page, PageQuery, PlatformAccount, ResetAccountPasswordResult } from '@fld/shared';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SessionService } from '@nestjs/authentication';
import { accountName, AuditService, changesOf } from '../audit/audit.service.js';
import { CredentialsService, UNLOCKED } from '../auth/credentials.service.js';
import { MfaSetupService } from '../auth/mfa-setup.service.js';
import { mfaEnabledAmong } from '../auth/mfa.store.js';
import type { Principal } from '../auth/principal.js';
import { generatePassword } from '../common/password.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const accountSelect = {
  id: true,
  username: true,
  displayName: true,
  email: true,
  status: true,
  lockedAt: true,
  lastSignInAt: true,
  memberships: {
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { tenant: { select: { id: true, name: true } } },
  },
} satisfies Prisma.UserSelect;

/** Every account of the platform, whichever tenants it belongs to. */
@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly mfa: MfaSetupService,
  ) {}

  async list({ page, pageSize, keyword }: PageQuery): Promise<Page<PlatformAccount>> {
    const where: Prisma.UserWhereInput = keyword
      ? {
          OR: [
            { username: { contains: keyword, mode: 'insensitive' } },
            { email: { contains: keyword, mode: 'insensitive' } },
            { displayName: { contains: keyword, mode: 'insensitive' } },
          ],
        }
      : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: accountSelect,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    const mfa = await mfaEnabledAmong(
      this.prisma,
      rows.map((row) => row.id),
    );
    return { items: rows.map((row) => toAccount(row, mfa)), total };
  }

  /**
   * Gives the account a generated password, which it must change at its next sign-in, and signs
   * it out everywhere. Not for one's own account, which has 「修改密码」.
   */
  async resetPassword(user: Principal, id: string): Promise<ResetAccountPasswordResult> {
    if (id === user.id) {
      throw new BadRequestException('不能在这里重置自己的密码，请用「修改密码」');
    }
    const account = await this.prisma.user.findUnique({
      where: { id: BigInt(id) },
      select: { id: true, username: true, displayName: true, lockedAt: true },
    });
    if (!account) {
      throw new NotFoundException('账号不存在');
    }
    const password = generatePassword();
    const passwordHash = await this.credentials.hash(password);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: account.id },
        data: { passwordHash, mustChangePassword: true, ...UNLOCKED },
      }),
      this.prisma.session.deleteMany({ where: { userId: account.id.toString() } }),
    ]);
    await this.audit.record({
      action: 'account.reset-password',
      target: { type: 'account', id: account.id, name: accountName(account) },
      changes: account.lockedAt ? changesOf([['账号', '已锁定', '已解锁']]) : [],
    });
    return { password };
  }

  /** Lets the account sign in again after too many wrong passwords locked it. */
  async unlock(id: string): Promise<PlatformAccount> {
    const userId = BigInt(id);
    if (!(await this.credentials.unlock(userId))) {
      throw (await this.prisma.user.count({ where: { id: userId } }))
        ? new BadRequestException('该账号没有被锁定')
        : new NotFoundException('账号不存在');
    }
    const account = await this.read(userId);
    await this.audit.record({
      action: 'account.unlock',
      target: { type: 'account', id: userId, name: accountName(account) },
    });
    return account;
  }

  /** Turns off two-step sign-in for someone who lost their phone and recovery codes. */
  async resetMfa(id: string): Promise<PlatformAccount> {
    const userId = BigInt(id);
    if (!(await this.mfa.reset(id))) {
      throw (await this.prisma.user.count({ where: { id: userId } }))
        ? new BadRequestException('该账号没有开启两步验证')
        : new NotFoundException('账号不存在');
    }
    const account = await this.read(userId);
    await this.audit.record({
      action: 'account.reset-mfa',
      target: { type: 'account', id: userId, name: accountName(account) },
    });
    return account;
  }

  private async read(userId: bigint): Promise<PlatformAccount> {
    const row = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: accountSelect,
    });
    return toAccount(row, await mfaEnabledAmong(this.prisma, [userId]));
  }

  /** Signs the account out on every device; its password stays as it is. */
  async signOut(id: string): Promise<void> {
    const account = await this.prisma.user.findUnique({
      where: { id: BigInt(id) },
      select: { id: true, username: true, displayName: true },
    });
    if (!account) {
      throw new NotFoundException('账号不存在');
    }
    await this.sessions.revokeAll(id);
    await this.audit.record({
      action: 'account.sign-out',
      target: { type: 'account', id: account.id, name: accountName(account) },
    });
  }
}

function toAccount(
  row: Prisma.UserGetPayload<{ select: typeof accountSelect }>,
  mfa: ReadonlySet<string>,
): PlatformAccount {
  return {
    id: row.id.toString(),
    username: row.username,
    displayName: row.displayName,
    email: row.email,
    status: row.status,
    locked: row.lockedAt !== null,
    mfaEnabled: mfa.has(row.id.toString()),
    lastSignInAt: row.lastSignInAt?.toISOString() ?? null,
    tenants: row.memberships.map(({ tenant }) => ({ id: tenant.id.toString(), name: tenant.name })),
  };
}
