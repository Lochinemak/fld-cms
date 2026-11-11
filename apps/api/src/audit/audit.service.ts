import type { AuditAction, AuditChange, AuditTargetType } from '@fld/shared';
import { Injectable, Logger } from '@nestjs/common';
import { AuthenticationContext } from '@nestjs/authentication';
import { PrismaService } from '../prisma/prisma.service.js';
import { SnowflakeService } from '../snowflake/snowflake.service.js';
import { currentRequest } from '../common/request-context.js';

type Id = string | bigint;

/** Someone as the audit log names them. Without an id, nobody: what a failed sign-in typed. */
export interface AuditActor {
  id: Id | null;
  username: string;
  displayName: string;
}

export interface AuditEvent {
  action: AuditAction;
  target?: { type: AuditTargetType; id?: Id | null; name: string };
  changes?: AuditChange[];
  /** False for an attempt that was refused or did nothing; `reason` says why. */
  success?: boolean;
  reason?: string;
  /**
   * For an event of an account itself, such as signing in or changing its password: the account,
   * which also counts as the actor, and every tenant it belongs to sees the event. Null when no
   * account is known, for the platform to see. Without it, the event is the signed-in user's, in
   * their current tenant.
   */
  account?: AuditActor | null;
  /** The tenant the event belongs to, when it isn't the signed-in user's current one. */
  tenantId?: Id;
}

type AuditValue = string | number | readonly string[] | null | undefined;

function words(value: AuditValue): string | null {
  if (typeof value === 'number') {
    return String(value);
  }
  const text = typeof value === 'string' || value == null ? value : value.join('、');
  return text || null;
}

/** The fields that changed, in words; unchanged ones are left out. Lists are joined. */
export function changesOf(
  fields: ReadonlyArray<readonly [field: string, from: AuditValue, to: AuditValue]>,
): AuditChange[] {
  return fields
    .map(([field, from, to]) => ({ field, from: words(from), to: words(to) }))
    .filter((change) => change.from !== change.to);
}

/** How the log names an account or member: 「张三（zhangsan）」. */
export function accountName(account: { username: string; displayName: string }): string {
  return `${account.displayName}（${account.username}）`;
}

function toId(id: Id | null | undefined): bigint | null {
  return id == null ? null : BigInt(id);
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly snowflake: SnowflakeService,
    private readonly auth: AuthenticationContext,
  ) {}

  /** The account as the audit log names it, or null if there is none. */
  account(id: Id): Promise<AuditActor | null> {
    return this.prisma.user.findUnique({
      where: { id: BigInt(id) },
      select: { id: true, username: true, displayName: true },
    });
  }

  /**
   * Adds the event to the audit log, with the current request's address, browser and id. Never
   * throws: a failure to record is logged, and what was done stays done.
   */
  async record(event: AuditEvent): Promise<void> {
    const ofAccount = event.account !== undefined;
    const user = this.auth.user;
    const actor = ofAccount ? event.account : user;
    const request = currentRequest();
    try {
      await this.prisma.auditLog.create({
        data: {
          id: this.snowflake.next(),
          tenantId: ofAccount ? null : toId(event.tenantId ?? user?.context?.tenant.id),
          accountId: ofAccount ? toId(event.account?.id) : null,
          actorId: toId(actor?.id),
          actorUsername: actor?.username.slice(0, 254) ?? null,
          actorName: actor?.displayName.slice(0, 64) || null,
          action: event.action,
          targetType: event.target?.type ?? null,
          targetId: toId(event.target?.id),
          targetName: event.target?.name.slice(0, 255) ?? null,
          success: event.success ?? true,
          reason: event.reason?.slice(0, 255) ?? null,
          changes: event.changes?.length ? event.changes : undefined,
          ip: request?.ip ?? null,
          userAgent: request?.userAgent ?? null,
          requestId: request?.requestId ?? null,
        },
      });
    } catch (error) {
      this.logger.error(
        `Could not record ${event.action} in the audit log`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
