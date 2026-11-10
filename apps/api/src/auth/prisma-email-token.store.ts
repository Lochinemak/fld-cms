import { Injectable } from '@nestjs/common';
import type { EmailTokenPurpose, EmailTokenRecord, EmailTokenStore } from '@nestjs/authentication';
import type { EmailToken } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** The most links kept waiting to be used: anyone can ask for one, so the table stays bounded. */
const MAX_PENDING = 10_000;

/**
 * Links sent by mail (password resets) in PostgreSQL. Using one is a single `DELETE … RETURNING`,
 * so a link works once however many requests present it at the same time.
 */
@Injectable()
export class PrismaEmailTokenStore implements EmailTokenStore {
  constructor(private readonly prisma: PrismaService) {}

  async saveEmailToken(record: EmailTokenRecord): Promise<void> {
    await this.prisma.emailToken.create({
      data: {
        id: record.id,
        purpose: record.purpose,
        userId: record.userId,
        email: record.email,
        fingerprint: record.fingerprint ?? null,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
      },
    });
    await this.prisma.emailToken.deleteMany({ where: { expiresAt: { lte: record.createdAt } } });
    await this.prisma.$executeRaw`
      DELETE FROM email_tokens WHERE id IN (
        SELECT id FROM email_tokens ORDER BY expires_at DESC, id OFFSET ${MAX_PENDING}
      )`;
  }

  async consumeEmailToken(
    id: string,
    purpose: EmailTokenPurpose,
  ): Promise<EmailTokenRecord | undefined> {
    const [row] = await this.prisma.$queryRaw<EmailToken[]>`
      DELETE FROM email_tokens WHERE id = ${id} AND purpose = ${purpose}
      RETURNING id, purpose, user_id AS "userId", email, fingerprint,
        created_at AS "createdAt", expires_at AS "expiresAt"`;
    return row && toRecord(row);
  }

  async deleteUserEmailTokens(userId: string, purpose: EmailTokenPurpose): Promise<void> {
    await this.prisma.emailToken.deleteMany({ where: { userId, purpose } });
  }
}

function toRecord(row: EmailToken): EmailTokenRecord {
  return {
    id: row.id,
    purpose: row.purpose as EmailTokenPurpose,
    userId: row.userId,
    email: row.email,
    ...(row.fingerprint === null ? {} : { fingerprint: row.fingerprint }),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}
