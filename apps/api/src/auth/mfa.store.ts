import { Injectable } from '@nestjs/common';
import type { MfaStore, TotpRecord } from '@nestjs/authentication';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

// Records a failure at ARGV[1] (ms), forgets those at or before ARGV[1] - ARGV[2], and counts the
// rest: one script, so parallel guesses each see every one recorded before them.
const RECORD_FAILURE = `
local cutoff = tonumber(ARGV[1]) - tonumber(ARGV[2])
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', cutoff)
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return redis.call('ZCOUNT', KEYS[1], '(' .. cutoff, '+inf')
`;

const failuresKey = (userId: string) => `fld:mfa-failures:${userId}`;

/**
 * Second factors: each user's authenticator and recovery codes in PostgreSQL, failed codes in
 * Redis. Every write that decides an outcome is one conditional statement, as the store contract
 * requires, so it holds with any number of API instances.
 */
@Injectable()
export class PrismaMfaStore implements MfaStore {
  private failures = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getTotp(userId: string): Promise<TotpRecord | undefined> {
    const row = await this.prisma.userTotp.findUnique({ where: { userId } });
    if (!row) {
      return undefined;
    }
    return {
      secret: row.secret,
      confirmed: row.confirmed,
      ...(row.pendingSecret !== null && { pendingSecret: row.pendingSecret }),
      ...(row.lastUsedStep !== null && { lastUsedStep: Number(row.lastUsedStep) }),
    };
  }

  async saveTotp(userId: string, record: TotpRecord | null): Promise<void> {
    if (!record) {
      await this.prisma.userTotp.deleteMany({ where: { userId } });
      return;
    }
    const step = record.lastUsedStep === undefined ? null : BigInt(record.lastUsedStep);
    // Never lowers the step: a record read before a concurrent claim must not reopen it.
    await this.prisma.$executeRaw`
      INSERT INTO user_totp (user_id, secret, confirmed, pending_secret, last_used_step, updated_at)
      VALUES (${userId}, ${record.secret}, ${record.confirmed}, ${record.pendingSecret ?? null},
        ${step}, now())
      ON CONFLICT (user_id) DO UPDATE SET
        secret = EXCLUDED.secret,
        confirmed = EXCLUDED.confirmed,
        pending_secret = EXCLUDED.pending_secret,
        last_used_step = GREATEST(user_totp.last_used_step, EXCLUDED.last_used_step),
        updated_at = now()`;
  }

  async claimTotpStep(userId: string, step: number): Promise<boolean> {
    const claimed = await this.prisma.$executeRaw`
      UPDATE user_totp SET last_used_step = ${BigInt(step)}
      WHERE user_id = ${userId} AND (last_used_step IS NULL OR last_used_step < ${BigInt(step)})`;
    return claimed > 0;
  }

  async saveRecoveryCodes(userId: string, hashes: string[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.mfaRecoveryCode.createMany({
        data: hashes.map((hash) => ({ userId, hash })),
        skipDuplicates: true,
      }),
    ]);
  }

  async consumeRecoveryCode(userId: string, hash: string): Promise<boolean> {
    const { count } = await this.prisma.mfaRecoveryCode.deleteMany({ where: { userId, hash } });
    return count > 0;
  }

  countRecoveryCodes(userId: string): Promise<number> {
    return this.prisma.mfaRecoveryCode.count({ where: { userId } });
  }

  async recordMfaFailure(userId: string, windowMs: number, now: number): Promise<number> {
    // Unique per failure, so two at the same millisecond both count.
    const member = `${now}:${process.pid}:${++this.failures}:${Math.random()}`;
    const count = await this.redis.eval(
      RECORD_FAILURE,
      1,
      failuresKey(userId),
      now,
      windowMs,
      member,
    );
    return Number(count);
  }

  async countMfaFailures(userId: string, windowMs: number, now: number): Promise<number> {
    return this.redis.zcount(failuresKey(userId), `(${now - windowMs}`, '+inf');
  }

  async clearMfaFailures(userId: string): Promise<void> {
    await this.redis.del(failuresKey(userId));
  }
}

/** Which of the accounts sign in in two steps: their ids, as text. */
export async function mfaEnabledAmong(
  prisma: Pick<PrismaService, 'userTotp'>,
  userIds: readonly bigint[],
): Promise<ReadonlySet<string>> {
  if (userIds.length === 0) {
    return new Set();
  }
  const rows = await prisma.userTotp.findMany({
    where: { userId: { in: userIds.map(String) }, confirmed: true },
    select: { userId: true },
  });
  return new Set(rows.map((row) => row.userId));
}
