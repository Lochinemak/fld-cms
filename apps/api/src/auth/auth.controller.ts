import { signInSchema, type Me, type SignInInput } from '@fld/shared';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { Public, SignInService } from '@nestjs/authentication';
import { ApiTags } from '@nestjs/swagger';
import { minutes, Throttle } from '@nestjs/throttler';
import { AccountRoute } from '../authz/account-route.decorator.js';
import { AccountService } from './account.service.js';
import { CredentialsService } from './credentials.service.js';

@ApiTags('auth')
@AccountRoute()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly credentials: CredentialsService,
    private readonly signIn: SignInService,
    private readonly accounts: AccountService,
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
}
