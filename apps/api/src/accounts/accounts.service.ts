import type { Page, PageQuery, PlatformAccount, ResetAccountPasswordResult } from '@fld/shared';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SessionService } from '@nestjs/authentication';
import { accountName, AuditService, changesOf } from '../audit/audit.service.js';
import { CredentialsService, UNLOCKED } from '../auth/credentials.service.js';
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
    return { items: rows.map(toAccount), total };
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
    const account = toAccount(
      await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: accountSelect }),
    );
    await this.audit.record({
      action: 'account.unlock',
      target: { type: 'account', id: userId, name: accountName(account) },
    });
    return account;
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

function toAccount(row: Prisma.UserGetPayload<{ select: typeof accountSelect }>): PlatformAccount {
  return {
    id: row.id.toString(),
    username: row.username,
    displayName: row.displayName,
    email: row.email,
    status: row.status,
    locked: row.lockedAt !== null,
    lastSignInAt: row.lastSignInAt?.toISOString() ?? null,
    tenants: row.memberships.map(({ tenant }) => ({ id: tenant.id.toString(), name: tenant.name })),
  };
}
