import {
  confirmEmailSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  type ConfirmEmailInput,
  type ConfirmEmailResult,
  type ForgotPasswordInput,
  type Me,
  type ResetPasswordInput,
  type SignInInput,
  type SignInOptions,
} from '@fld/shared';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import {
  Authenticate,
  CurrentUser,
  PasswordResetService,
  Public,
  SignInService,
} from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { ApiTags } from '@nestjs/swagger';
import { minutes, Throttle } from '@nestjs/throttler';
import { AuditService, changesOf } from '../audit/audit.service.js';
import { AccountRoute } from '../authz/account-route.decorator.js';
import { LogtoSettingsService } from '../settings/logto-settings.service.js';
import { normalizeAccount } from './account-name.js';
import { AccountService } from './account.service.js';
import { CredentialsService, SIGN_IN_ATTEMPTS, type SignInRefusal } from './credentials.service.js';
import { PasswordRecoveryService } from './password-recovery.service.js';
import type { Principal } from './principal.js';
import { ProfileService } from './profile.service.js';

const REFUSALS: Record<SignInRefusal, string> = {
  'unknown-account': '账号不存在',
  'wrong-password': '密码错误',
  disabled: '账号已停用',
  locked: '账号已锁定',
};

@ApiTags('auth')
@AccountRoute()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly credentials: CredentialsService,
    private readonly signIn: SignInService,
    private readonly accounts: AccountService,
    private readonly recovery: PasswordRecoveryService,
    private readonly passwordReset: PasswordResetService,
    private readonly profile: ProfileService,
    private readonly audit: AuditService,
    private readonly logto: LogtoSettingsService,
  ) {}

  /** What the sign-in page offers besides a password. */
  @Public()
  @Get('sign-in-options')
  async signInOptions(): Promise<SignInOptions> {
    return { logto: (await this.logto.app()) !== null };
  }

  /** Signs in with a username or email and password, in the tenant used last. */
  @Public()
  @Throttle({
    default: { limit: 30, ttl: minutes(15) },
    account: { limit: 5, ttl: minutes(15) },
  })
  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  async signInWithPassword(@Body({ schema: signInSchema }) input: SignInInput): Promise<Me> {
    const verification = await this.credentials.verify(input.account, input.password);
    if (!verification.ok) {
      const { refusal, lockedNow = false } = verification;
      const account = verification.account ?? {
        id: null,
        username: normalizeAccount(input.account),
        displayName: '',
      };
      await this.audit.record({
        action: 'auth.sign-in',
        success: false,
        reason: REFUSALS[lockedNow ? 'wrong-password' : refusal],
        account,
      });
      if (lockedNow) {
        await this.audit.record({
          action: 'auth.lock',
          account,
          changes: changesOf([['连续输错密码', null, `${SIGN_IN_ATTEMPTS} 次`]]),
        });
      }
      throw new UnauthorizedException(
        refusal === 'locked'
          ? '账号已锁定，请联系管理员解锁，或用忘记密码重设'
          : '用户名、邮箱或密码不正确',
      );
    }
    const { user } = verification;
    await this.signIn.signIn(user.id, { method: 'password' });
    await this.accounts.recordSignIn(user.id);
    await this.audit.record({ action: 'auth.sign-in', account: user });
    return this.accounts.describeUser(user.id);
  }

  /** Ends this browser's session, if it has one. */
  @Authenticate({ optional: true })
  @Can.Anyone()
  @Post('sign-out')
  @HttpCode(HttpStatus.NO_CONTENT)
  async signOut(@CurrentUser() user: Principal | null): Promise<void> {
    if ((await this.signIn.signOut()) && user) {
      await this.audit.record({ action: 'auth.sign-out', account: user });
    }
  }

  /**
   * Mails a link to set a new password to the address of the account named, if it is active and
   * has one. The answer doesn't tell which.
   */
  @Public()
  @Throttle({
    default: { limit: 30, ttl: minutes(15) },
    account: { limit: 5, ttl: minutes(15) },
  })
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(
    @Body({ schema: forgotPasswordSchema }) input: ForgotPasswordInput,
  ): Promise<void> {
    await this.recovery.request(input.account);
  }

  /** Sets a new password with a mailed link's token, and signs the account out everywhere. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: minutes(15) } })
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(
    @Body({ schema: resetPasswordSchema }) input: ResetPasswordInput,
  ): Promise<void> {
    const result = await this.passwordReset.reset(input.token, input.newPassword);
    if (!result) {
      await this.audit.record({
        action: 'auth.reset-password',
        account: null,
        success: false,
        reason: '链接无效或已过期',
      });
      throw new BadRequestException('链接无效或已过期，请重新申请');
    }
    const unlocked = await this.credentials.unlock(BigInt(result.userId));
    await this.audit.record({
      action: 'auth.reset-password',
      account: await this.audit.account(result.userId),
      changes: unlocked ? changesOf([['账号', '已锁定', '已解锁']]) : [],
    });
  }

  /** Makes the address a link was mailed to the account's email, for whoever holds the link. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: minutes(15) } })
  @Post('confirm-email')
  @HttpCode(HttpStatus.OK)
  async confirmEmail(
    @Body({ schema: confirmEmailSchema }) input: ConfirmEmailInput,
  ): Promise<ConfirmEmailResult> {
    const email = await this.profile.confirmEmail(input.token);
    if (!email) {
      throw new BadRequestException('链接无效或已过期，请回到个人资料重新修改邮箱');
    }
    return { email };
  }
}
