import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

const DAY = 24 * 60 * 60 * 1000;

/** Removes audit records once they are older than AUDIT_RETENTION_DAYS. AuditProcessor runs it daily. */
@Injectable()
export class AuditRetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Removes the records older than the retention period before `now`, and says how many. */
  async removeExpired(now = new Date()): Promise<number> {
    const days = this.config.get('AUDIT_RETENTION_DAYS', { infer: true });
    const { count } = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - days * DAY) } },
    });
    return count;
  }
}
