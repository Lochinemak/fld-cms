import type { SignInSession } from '@fld/shared';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SessionService, type SessionRecord } from '@nestjs/authentication';
import { AuditService } from '../audit/audit.service.js';
import { readableIp } from '../common/request-context.js';
import { signedInWithLogto } from './logto.js';
import type { Principal } from './principal.js';

const text = (value: unknown) => (typeof value === 'string' && value ? value : null);

/** The browsers and devices the signed-in account is signed in on, and signing them out. */
@Injectable()
export class SignInSessionsService {
  constructor(
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /** The live ones, the current one first, then the most recently used. */
  async list(user: Principal, current: SessionRecord): Promise<SignInSession[]> {
    const live = await this.sessions.list(user.id);
    return live
      .map((session) => ({
        id: session.id,
        current: session.id === current.id,
        method: signedInWithLogto(session) ? ('logto' as const) : ('password' as const),
        ip: readableIp(text(session.metadata?.['ip']) ?? undefined),
        userAgent: text(session.metadata?.['userAgent']),
        createdAt: session.createdAt.toISOString(),
        lastActiveAt: session.lastActiveAt.toISOString(),
      }))
      .sort(
        (a, b) =>
          Number(b.current) - Number(a.current) || b.lastActiveAt.localeCompare(a.lastActiveAt),
      );
  }

  /** Signs out one other device. This one signs out with 退出登录. */
  async revoke(user: Principal, current: SessionRecord, id: string): Promise<void> {
    if (id === current.id) {
      throw new BadRequestException('要退出当前设备，请用「退出登录」');
    }
    if (!(await this.sessions.revoke(id, { userId: user.id }))) {
      throw new NotFoundException('该登录已经失效');
    }
    await this.audit.record({ action: 'auth.revoke-session', account: user });
  }

  /** Signs out every device but this one. */
  async revokeOthers(user: Principal, current: SessionRecord): Promise<void> {
    await this.sessions.revokeAll(user.id, { except: current.id });
    await this.audit.record({ action: 'auth.revoke-session', account: user });
  }
}
