import {
  EMAIL_CHANGE_MINUTES,
  type AuditChange,
  type UpdateProfileInput,
  type UpdateProfileResult,
} from '@fld/shared';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { MailService } from '../settings/mail.service.js';
import { PlatformSettingsService } from '../settings/platform-settings.service.js';
import { AccountService } from './account.service.js';
import { CredentialsService } from './credentials.service.js';
import { allowMailLink } from './mail-link-limit.js';
import { PrismaEmailTokenStore } from './prisma-email-token.store.js';
import type { Principal } from './principal.js';

/** The web app's page that takes the link's token and asks to confirm the new email. */
export const CONFIRM_EMAIL_PATH = '/confirm-email';

/** Tries at the password, within the minutes below, that changing the email allows an account. */
export const EMAIL_CHANGE_ATTEMPTS = 5;
const ATTEMPT_MINUTES = 15;

// Counts a try, the first one starting the wait.
const COUNT_ATTEMPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`;

const sha256 = (value: string) => createHash('sha256').update(value).digest('base64url');

/**
 * Users changing their own name and email. The name changes at once. Password resets are mailed
 * to the email, and Logto finds the account by it, so a different one takes the password, and
 * becomes the account's only once the link mailed to it is used: nobody takes an address whose
 * mail they can't read.
 */
@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly credentials: CredentialsService,
    private readonly settings: PlatformSettingsService,
    private readonly mail: MailService,
    private readonly emailTokens: PrismaEmailTokenStore,
    private readonly accounts: AccountService,
    private readonly audit: AuditService,
  ) {}

  async update(principal: Principal, input: UpdateProfileInput): Promise<UpdateProfileResult> {
    const { displayName, email } = input;
    const emailChanges = email !== principal.email;
    if (emailChanges) {
      if (email && !(await this.settings.mailReady())) {
        throw new ServiceUnavailableException('还没有配置邮件服务，暂时不能修改邮箱，请联系管理员');
      }
      await this.confirmPassword(principal, input.currentPassword);
      if (email) {
        // Before anything is saved, so that nothing is when the mail doesn't go.
        await this.mailLink(principal, email, displayName);
      }
    }
    // Going without an address has nothing to confirm.
    const cleared = emailChanges && email === null;
    const changes: AuditChange[] = [];
    if (displayName !== principal.displayName) {
      changes.push({ field: '姓名', from: principal.displayName, to: displayName });
    }
    if (cleared) {
      changes.push({ field: '邮箱', from: principal.email, to: null });
    }
    if (changes.length > 0) {
      await this.prisma.user.update({
        where: { id: BigInt(principal.id) },
        data: { displayName, ...(cleared && { email: null }) },
      });
      if (cleared) {
        // Neither the links mailed to the address it had, nor one to an address it asked for.
        await this.emailTokens.deleteUserEmailTokens(principal.id, 'password-reset');
        await this.emailTokens.deleteUserEmailTokens(principal.id, 'email-verification');
      }
      await this.audit.record({ action: 'auth.update-profile', account: principal, changes });
    }
    return {
      me: await this.accounts.describe({
        ...principal,
        displayName,
        ...(cleared && { email: null }),
      }),
      confirmationSentTo: emailChanges ? email : null,
    };
  }

  /**
   * Makes the address of a mailed link the account's, for whoever holds the link: only the
   * address got it. The address, or null for a link that is unknown, used, expired or void.
   */
  async confirmEmail(token: string): Promise<string | null> {
    const link = await this.emailTokens.consumeEmailToken(sha256(token), 'email-verification');
    const user = link
      ? await this.prisma.user.findUnique({
          where: { id: BigInt(link.userId) },
          select: {
            id: true,
            username: true,
            displayName: true,
            email: true,
            passwordHash: true,
            status: true,
          },
        })
      : null;
    const account = user
      ? { id: user.id, username: user.username, displayName: user.displayName }
      : null;
    if (
      !link ||
      !user ||
      link.expiresAt.getTime() <= Date.now() ||
      user.status !== 'ACTIVE' ||
      // A password changed since, by any route, voids the links asked for under the one before.
      sha256(user.passwordHash ?? '') !== link.fingerprint
    ) {
      await this.audit.record({
        action: 'auth.update-profile',
        account,
        success: false,
        reason: '确认链接无效或已过期',
      });
      return null;
    }
    const change: AuditChange = { field: '邮箱', from: user.email, to: link.email };
    try {
      await this.prisma.user.update({ where: { id: user.id }, data: { email: link.email } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        await this.audit.record({
          action: 'auth.update-profile',
          account,
          changes: [change],
          success: false,
          reason: '邮箱已被其他账号使用',
        });
        throw new ConflictException('这个邮箱已被其他账号使用，没有修改');
      }
      throw error;
    }
    // Links mailed to the address the account had stay void even if it takes the address back.
    await this.emailTokens.deleteUserEmailTokens(link.userId, 'password-reset');
    await this.audit.record({ action: 'auth.update-profile', account, changes: [change] });
    return link.email;
  }

  /** The password, for changing the email. An account that keeps getting it wrong has to wait. */
  private async confirmPassword(principal: Principal, password: string | undefined): Promise<void> {
    if (!password) {
      throw new BadRequestException('修改邮箱需要输入当前密码');
    }
    const attempts = `fld:email-change:attempts:${principal.id}`;
    const count = await this.redis.eval(COUNT_ATTEMPT, 1, attempts, ATTEMPT_MINUTES * 60);
    if (Number(count) > EMAIL_CHANGE_ATTEMPTS) {
      await this.audit.record({
        action: 'auth.update-profile',
        account: principal,
        success: false,
        reason: '当前密码输错的次数太多',
      });
      throw new HttpException(
        `当前密码输错的次数太多，请 ${ATTEMPT_MINUTES} 分钟后再试`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (await this.credentials.check(BigInt(principal.id), password)) {
      await this.redis.del(attempts);
      return;
    }
    await this.audit.record({
      action: 'auth.update-profile',
      account: principal,
      success: false,
      reason: '当前密码不正确',
    });
    throw new BadRequestException('当前密码不正确');
  }

  /**
   * Mails `email` the link that makes it the account's address, greeting the account by the name
   * it is about to have.
   */
  private async mailLink(principal: Principal, email: string, displayName: string): Promise<void> {
    const changes: AuditChange[] = [{ field: '邮箱', from: principal.email, to: email }];
    const refuse = (reason: string) =>
      this.audit.record({
        action: 'auth.request-email-change',
        account: principal,
        changes,
        success: false,
        reason,
      });
    if (await this.prisma.user.count({ where: { email } })) {
      await refuse('邮箱已被其他账号使用');
      throw new ConflictException('邮箱已被其他账号使用');
    }
    if (!(await allowMailLink(this.redis, 'email-change', principal.id))) {
      await refuse('申请太频繁，没有发送邮件');
      throw new HttpException('确认邮件发得太频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }
    const [user, siteUrl] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: BigInt(principal.id) },
        select: { passwordHash: true },
      }),
      this.settings.siteUrl(),
    ]);
    if (!siteUrl) {
      throw new Error('No site address is set for the link confirming a new email');
    }
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    // Only the newest link works.
    await this.emailTokens.deleteUserEmailTokens(principal.id, 'email-verification');
    await this.emailTokens.saveEmailToken({
      id: sha256(token),
      purpose: 'email-verification',
      userId: principal.id,
      email,
      fingerprint: sha256(user.passwordHash ?? ''),
      createdAt: new Date(now),
      expiresAt: new Date(now + EMAIL_CHANGE_MINUTES * 60_000),
    });
    const url = new URL(`${siteUrl}${CONFIRM_EMAIL_PATH}`);
    url.searchParams.set('token', token);
    try {
      await this.mail.sendTemplate('email-change', email, {
        姓名: displayName,
        用户名: principal.username,
        新邮箱: email,
        确认链接: url.toString(),
        有效分钟: String(EMAIL_CHANGE_MINUTES),
      });
    } catch (error) {
      this.logger.error(
        'The mail confirming a new email could not be sent',
        error instanceof Error ? error.stack : error,
      );
      await refuse('确认邮件没有发出去');
      throw new BadGatewayException('确认邮件没有发出去，请稍后再试，或联系管理员检查邮件服务');
    }
    await this.audit.record({ action: 'auth.request-email-change', account: principal, changes });
  }
}
