import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AuthenticationStorage, PasswordResetService } from '@nestjs/authentication';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { PlatformSettingsService } from '../settings/platform-settings.service.js';
import { normalizeAccount } from './account-name.js';
import { allowMailLink } from './mail-link-limit.js';

/**
 * 「忘记密码」: mails a link to set a new password to the address of the account named by its
 * username or email, through the authentication module's password reset. The answer is the same,
 * and as quick, whether or not the account exists, has an address or went over its limit.
 */
@Injectable()
export class PasswordRecoveryService {
  private readonly logger = new Logger(PasswordRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly settings: PlatformSettingsService,
    private readonly passwordReset: PasswordResetService,
    private readonly storage: AuthenticationStorage,
    private readonly audit: AuditService,
  ) {}

  async request(account: string): Promise<void> {
    if (!(await this.settings.mailReady())) {
      throw new ServiceUnavailableException('还没有配置邮件服务，请联系管理员重置密码');
    }
    // The account is looked up once the caller has its answer.
    setImmediate(() => {
      this.issue(account).catch((error: unknown) =>
        this.logger.error(
          'A password reset request failed',
          error instanceof Error ? error.stack : error,
        ),
      );
    });
  }

  private async issue(account: string): Promise<void> {
    const normalized = normalizeAccount(account);
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ username: normalized }, { email: normalized }] },
      select: { id: true, username: true, displayName: true, email: true, status: true },
    });
    const refusal = await this.refusal(user);
    await this.audit.record({
      action: 'auth.forgot-password',
      account: user ?? { id: null, username: normalized, displayName: '' },
      ...(refusal ? { success: false, reason: `${refusal}，没有发送邮件` } : {}),
    });
    if (refusal || !user?.email) {
      return;
    }
    // A new link replaces those sent before.
    await this.storage.emailTokens.deleteUserEmailTokens(user.id.toString(), 'password-reset');
    this.passwordReset.request(user.email);
  }

  /** Why no link goes to the account, if none does. */
  private async refusal(
    user: { id: bigint; email: string | null; status: string } | null,
  ): Promise<string | null> {
    if (!user) {
      return '账号不存在';
    }
    if (user.status !== 'ACTIVE') {
      return '账号已停用';
    }
    if (!user.email) {
      return '账号没有邮箱';
    }
    return (await allowMailLink(this.redis, 'password-reset', user.id)) ? null : '申请太频繁';
  }
}
