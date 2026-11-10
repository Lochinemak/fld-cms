import { PASSWORD_RESET_MINUTES } from '@fld/shared';
import { Injectable } from '@nestjs/common';
import {
  AuthenticationRegistry,
  PasswordResetHandler,
  type PasswordResetAccount,
  type PasswordResetLink,
} from '@nestjs/authentication';
import { PrismaService } from '../prisma/prisma.service.js';
import { MailService } from '../settings/mail.service.js';
import { PlatformSettingsService } from '../settings/platform-settings.service.js';

/** The web app's page that takes the link's token and asks for the new password. */
export const RESET_PASSWORD_PATH = '/reset-password';

/**
 * What the authentication module's password reset asks of the app: the active account with an
 * address, the mail that carries the link, and storing the new password.
 */
@Injectable()
export class PasswordResetMailer extends PasswordResetHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
    private readonly mail: MailService,
    registry: AuthenticationRegistry,
  ) {
    super();
    registry.registerHandler('passwordReset', this);
  }

  async findUser(email: string): Promise<PasswordResetAccount | null> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true, status: true },
    });
    if (!user?.email || user.status !== 'ACTIVE') {
      return null;
    }
    return { id: user.id.toString(), email: user.email, passwordHash: user.passwordHash };
  }

  async send(link: PasswordResetLink): Promise<void> {
    const [user, siteUrl] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: BigInt(link.userId) },
        select: { username: true, displayName: true },
      }),
      this.settings.siteUrl(),
    ]);
    if (!siteUrl) {
      throw new Error('No site address is set for the password reset link');
    }
    // The module's link carries the address configured at start; the settings page may have
    // changed the site's since.
    const url = new URL(`${siteUrl}${RESET_PASSWORD_PATH}`);
    url.searchParams.set('token', new URL(link.url).searchParams.get('token') ?? '');
    await this.mail.sendTemplate('password-reset', link.email, {
      姓名: user.displayName,
      用户名: user.username,
      重设链接: url.toString(),
      有效分钟: String(PASSWORD_RESET_MINUTES),
    });
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: BigInt(userId) },
      data: { passwordHash, mustChangePassword: false },
    });
  }
}
