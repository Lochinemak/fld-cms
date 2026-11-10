import { Injectable } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import { PrismaService } from '../prisma/prisma.service.js';
import { normalizeAccount } from './account-name.js';
import type { SessionUser } from './principal.js';
import { sessionUserSelect, toSessionUser } from './session-user.js';

@Injectable()
export class CredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  /** The active account the username or email and password prove, or null. */
  async verify(account: string, password: string): Promise<SessionUser | null> {
    const normalized = normalizeAccount(account);
    const row = await this.prisma.user.findFirst({
      where: { OR: [{ username: normalized }, { email: normalized }] },
      select: { ...sessionUserSelect, passwordHash: true },
    });
    // Without a row, verify() still checks a dummy hash, so timing doesn't reveal which accounts exist.
    const valid = await this.passwordHasher.verify(password, row?.passwordHash);
    if (!valid || !row?.passwordHash || row.status !== 'ACTIVE') {
      return null;
    }
    if (this.passwordHasher.needsRehash(row.passwordHash)) {
      await this.prisma.user.update({
        where: { id: row.id },
        data: { passwordHash: await this.passwordHasher.hash(password) },
      });
    }
    return toSessionUser(row);
  }

  /** Whether the password is the account's current one. */
  async check(userId: bigint, password: string): Promise<boolean> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    return this.passwordHasher.verify(password, row?.passwordHash);
  }

  hash(password: string): Promise<string> {
    return this.passwordHasher.hash(password);
  }
}
