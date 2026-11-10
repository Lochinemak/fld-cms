import {
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  type ForgotPasswordInput,
  type Me,
  type ResetPasswordInput,
  type SignInInput,
} from '@fld/shared';
import {
  BadRequestException,
  Body,
  Controller,
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
import { AuditService } from '../audit/audit.service.js';
import { AccountRoute } from '../authz/account-route.decorator.js';
import { normalizeAccount } from './account-name.js';
import { AccountService } from './account.service.js';
import { CredentialsService, type SignInRefusal } from './credentials.service.js';
import { PasswordRecoveryService } from './password-recovery.service.js';
import type { Principal } from './principal.js';

const REFUSALS: Record<SignInRefusal, string> = {
  'unknown-account': '账号不存在',
  'wrong-password': '密码错误',
  disabled: '账号已停用',
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
    private readonly audit: AuditService,
  ) {}

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
      await this.audit.record({
        action: 'auth.sign-in',
        success: false,
        reason: REFUSALS[verification.refusal],
        account: verification.account ?? {
          id: null,
          username: normalizeAccount(input.account),
          displayName: '',
        },
      });
      throw new UnauthorizedException('用户名、邮箱或密码不正确');
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
    await this.audit.record({
      action: 'auth.reset-password',
      account: await this.audit.account(result.userId),
    });
  }
}
