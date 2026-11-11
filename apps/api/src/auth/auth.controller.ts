import {
  confirmEmailSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  verifyMfaSchema,
  type ConfirmEmailInput,
  type ConfirmEmailResult,
  type ForgotPasswordInput,
  type Me,
  type ResetPasswordInput,
  type SignInInput,
  type SignInOptions,
  type SignInResult,
  type VerifyMfaInput,
} from '@fld/shared';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  Authenticate,
  CurrentUser,
  PasswordResetService,
  Public,
  SessionService,
  SignInService,
} from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { ApiTags } from '@nestjs/swagger';
import { minutes, Throttle } from '@nestjs/throttler';
import { AuditService, changesOf } from '../audit/audit.service.js';
import { AccountRoute } from '../authz/account-route.decorator.js';
import { LogtoSettingsService } from '../settings/logto-settings.service.js';
import type { Request } from 'express';
import { normalizeAccount } from './account-name.js';
import { LOGTO } from './logto.js';
import { PrismaMfaStore } from './mfa.store.js';
import { AccountService } from './account.service.js';
import { CredentialsService, SIGN_IN_ATTEMPTS, type SignInRefusal } from './credentials.service.js';
import { PasswordRecoveryService } from './password-recovery.service.js';
import type { Principal } from './principal.js';
import { ProfileService } from './profile.service.js';

/** MfaService's defaults: this many wrong codes within 15 minutes, and every code is refused. */
const MFA_ATTEMPTS = 5;
const MFA_LOCKOUT_MS = 15 * 60 * 1000;

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
    private readonly sessions: SessionService,
    private readonly mfaStore: PrismaMfaStore,
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
  async signInWithPassword(
    @Body({ schema: signInSchema }) input: SignInInput,
  ): Promise<SignInResult> {
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
    const { session } = await this.signIn.signIn(user.id, { method: 'password' });
    // Signed in once the code from the authenticator app follows, at POST /auth/mfa.
    if (session.mfa === 'pending') {
      return { mfaRequired: true };
    }
    await this.accounts.recordSignIn(user.id);
    await this.audit.record({ action: 'auth.sign-in', account: user });
    return this.accounts.describeUser(user.id);
  }

  /**
   * The second step of a sign-in, password or Logto, for an account with two-step sign-in on: a
   * code from its authenticator app, or one of its recovery codes.
   */
  @Public()
  @Throttle({ default: { limit: 30, ttl: minutes(15) } })
  @Post('mfa')
  @HttpCode(HttpStatus.OK)
  async verifyMfa(
    @Req() request: Request,
    @Body({ schema: verifyMfaSchema }) input: VerifyMfaInput,
  ): Promise<Me> {
    const pending = await this.sessions.validate(this.sessions.tokenFrom(request));
    if (pending?.mfa !== 'pending') {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }
    const account = await this.audit.account(pending.userId);
    const viaLogto = pending.metadata?.['method'] === LOGTO;
    const action = viaLogto ? 'auth.sign-in-logto' : 'auth.sign-in';
    const issued = await this.signIn.completeMfa(input);
    if (!issued) {
      const tooMany =
        (await this.mfaStore.countMfaFailures(pending.userId, MFA_LOCKOUT_MS, Date.now())) >=
        MFA_ATTEMPTS;
      await this.audit.record({
        action,
        account,
        success: false,
        reason: tooMany ? '两步验证输错太多次' : '两步验证码不正确',
      });
      throw new BadRequestException(tooMany ? '输错太多次，请 15 分钟后再试' : '验证码不正确');
    }
    await this.accounts.recordSignIn(pending.userId);
    await this.audit.record({ action, account });
    return this.accounts.describeUser(pending.userId);
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
