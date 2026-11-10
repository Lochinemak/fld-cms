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
import { PasswordResetService, Public, SignInService } from '@nestjs/authentication';
import { ApiTags } from '@nestjs/swagger';
import { minutes, Throttle } from '@nestjs/throttler';
import { AccountRoute } from '../authz/account-route.decorator.js';
import { AccountService } from './account.service.js';
import { CredentialsService } from './credentials.service.js';
import { PasswordRecoveryService } from './password-recovery.service.js';

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
    const user = await this.credentials.verify(input.account, input.password);
    if (!user) {
      throw new UnauthorizedException('用户名、邮箱或密码不正确');
    }
    await this.signIn.signIn(user.id, { method: 'password' });
    await this.accounts.recordSignIn(user.id);
    return this.accounts.describeUser(user.id);
  }

  /** Ends this browser's session, if it has one. */
  @Public()
  @Post('sign-out')
  @HttpCode(HttpStatus.NO_CONTENT)
  async signOut(): Promise<void> {
    await this.signIn.signOut();
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
    if (!(await this.passwordReset.reset(input.token, input.newPassword))) {
      throw new BadRequestException('链接无效或已过期，请重新申请');
    }
  }
}
