import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AuthenticationStorage, PasswordResetService } from '@nestjs/authentication';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { PlatformSettingsService } from '../settings/platform-settings.service.js';
import { normalizeAccount } from './account-name.js';

const LINKS_PER_HOUR = 5;

// One link a minute, and LINKS_PER_HOUR an hour, per account: the minute's marker first, then the
// hour's count. 1 when this link may go.
const ALLOW_LINK = `
if not redis.call('SET', KEYS[1], '1', 'EX', ARGV[1], 'NX') then
  return 0
end
local count = redis.call('INCR', KEYS[2])
if count == 1 then
  redis.call('EXPIRE', KEYS[2], ARGV[2])
end
if count > tonumber(ARGV[3]) then
  return 0
end
return 1
`;

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
      where: { status: 'ACTIVE', OR: [{ username: normalized }, { email: normalized }] },
      select: { id: true, email: true },
    });
    if (!user?.email || !(await this.allow(user.id))) {
      return;
    }
    // A new link replaces those sent before.
    await this.storage.emailTokens.deleteUserEmailTokens(user.id.toString(), 'password-reset');
    this.passwordReset.request(user.email);
  }

  private async allow(userId: bigint): Promise<boolean> {
    const allowed = await this.redis.eval(
      ALLOW_LINK,
      2,
      `fld:password-reset:minute:${userId}`,
      `fld:password-reset:hour:${userId}`,
      60,
      3600,
      LINKS_PER_HOUR,
    );
    return allowed === 1;
  }
}
