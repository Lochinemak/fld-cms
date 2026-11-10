import { Injectable } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { normalizeAccount } from './account-name.js';
import type { SessionUser } from './principal.js';
import { sessionUserSelect, toSessionUser } from './session-user.js';

/** Wrong passwords in a row that lock an account. */
export const SIGN_IN_ATTEMPTS = 10;

/** Unlocks an account, and starts its count of wrong passwords over, in a user update. */
export const UNLOCKED = { failedSignIns: 0, lockedAt: null } satisfies Prisma.UserUpdateInput;

export type SignInRefusal = 'unknown-account' | 'wrong-password' | 'disabled' | 'locked';

/** The account a sign-in proves, or why it doesn't and which account it named. */
export type Verification =
  | { ok: true; user: SessionUser }
  | {
      ok: false;
      refusal: SignInRefusal;
      account: SessionUser | null;
      /** This very attempt was the one too many that locked the account. */
      lockedNow?: boolean;
    };

@Injectable()
export class CredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  /**
   * Whether the username or email and password prove an active account. Wrong passwords count
   * towards locking the account, and a sign-in starts the count over.
   */
  async verify(account: string, password: string): Promise<Verification> {
    const normalized = normalizeAccount(account);
    const row = await this.prisma.user.findFirst({
      where: { OR: [{ username: normalized }, { email: normalized }] },
      select: { ...sessionUserSelect, passwordHash: true, failedSignIns: true, lockedAt: true },
    });
    // Without a row, verify() still checks a dummy hash, so timing doesn't reveal which accounts exist.
    const valid = await this.passwordHasher.verify(password, row?.passwordHash);
    if (!row) {
      return { ok: false, refusal: 'unknown-account', account: null };
    }
    const user = toSessionUser(row);
    if (row.lockedAt) {
      return { ok: false, refusal: 'locked', account: user };
    }
    if (!valid || !row.passwordHash) {
      const lockedNow = await this.countWrongPassword(row.id);
      return {
        ok: false,
        refusal: lockedNow ? 'locked' : 'wrong-password',
        account: user,
        lockedNow,
      };
    }
    if (row.status !== 'ACTIVE') {
      return { ok: false, refusal: 'disabled', account: user };
    }
    const rehash = this.passwordHasher.needsRehash(row.passwordHash);
    if (rehash || row.failedSignIns > 0) {
      await this.prisma.user.update({
        where: { id: row.id },
        data: {
          failedSignIns: 0,
          ...(rehash ? { passwordHash: await this.passwordHasher.hash(password) } : {}),
        },
      });
    }
    return { ok: true, user };
  }

  /** Counts a wrong password against an unlocked account; whether that locked it. */
  private async countWrongPassword(userId: bigint): Promise<boolean> {
    const [row] = await this.prisma.$queryRaw<{ locked: boolean }[]>`
      UPDATE users
      SET failed_sign_ins = failed_sign_ins + 1,
          locked_at = CASE WHEN failed_sign_ins + 1 >= ${SIGN_IN_ATTEMPTS} THEN now() END
      WHERE id = ${userId} AND locked_at IS NULL
      RETURNING locked_at IS NOT NULL AS locked`;
    return row?.locked ?? false;
  }

  /** Unlocks the account and starts its count of wrong passwords over; whether it was locked. */
  async unlock(userId: bigint): Promise<boolean> {
    const [{ count }] = await this.prisma.$transaction([
      this.prisma.user.updateMany({
        where: { id: userId, lockedAt: { not: null } },
        data: UNLOCKED,
      }),
      this.prisma.user.updateMany({ where: { id: userId }, data: UNLOCKED }),
    ]);
    return count > 0;
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
