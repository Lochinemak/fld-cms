import { Injectable } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import { PrismaService } from '../prisma/prisma.service.js';
import { normalizeAccount } from './account-name.js';
import type { SessionUser } from './principal.js';
import { sessionUserSelect, toSessionUser } from './session-user.js';

export type SignInRefusal = 'unknown-account' | 'wrong-password' | 'disabled';

/** The account a sign-in proves, or why it doesn't and which account it named. */
export type Verification =
  | { ok: true; user: SessionUser }
  | { ok: false; refusal: SignInRefusal; account: SessionUser | null };

@Injectable()
export class CredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  /** Whether the username or email and password prove an active account. */
  async verify(account: string, password: string): Promise<Verification> {
    const normalized = normalizeAccount(account);
    const row = await this.prisma.user.findFirst({
      where: { OR: [{ username: normalized }, { email: normalized }] },
      select: { ...sessionUserSelect, passwordHash: true },
    });
    // Without a row, verify() still checks a dummy hash, so timing doesn't reveal which accounts exist.
    const valid = await this.passwordHasher.verify(password, row?.passwordHash);
    if (!row) {
      return { ok: false, refusal: 'unknown-account', account: null };
    }
    if (!valid || !row.passwordHash) {
      return { ok: false, refusal: 'wrong-password', account: toSessionUser(row) };
    }
    if (row.status !== 'ACTIVE') {
      return { ok: false, refusal: 'disabled', account: toSessionUser(row) };
    }
    if (this.passwordHasher.needsRehash(row.passwordHash)) {
      await this.prisma.user.update({
        where: { id: row.id },
        data: { passwordHash: await this.passwordHasher.hash(password) },
      });
    }
    return { ok: true, user: toSessionUser(row) };
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
