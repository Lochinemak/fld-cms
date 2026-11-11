import {
  changePasswordSchema,
  switchTenantSchema,
  updateProfileSchema,
  type ChangePasswordInput,
  type Me,
  type SignInSession,
  type SwitchTenantInput,
  type UpdateProfileInput,
  type UpdateProfileResult,
} from '@fld/shared';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { CurrentSession, CurrentUser, type SessionRecord } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { ApiTags } from '@nestjs/swagger';
import { minutes, Throttle } from '@nestjs/throttler';
import { AccountRoute } from '../authz/account-route.decorator.js';
import { AccountService } from './account.service.js';
import type { Principal } from './principal.js';
import { ProfileService } from './profile.service.js';
import { SignInSessionsService } from './sign-in-sessions.service.js';

@ApiTags('me')
@AccountRoute()
@Can.Anyone()
@Controller('me')
export class MeController {
  constructor(
    private readonly accounts: AccountService,
    private readonly profile: ProfileService,
    private readonly signInSessions: SignInSessionsService,
  ) {}

  /** The signed-in user, their current tenant and the permissions they hold there. */
  @Get()
  me(@CurrentUser() user: Principal): Promise<Me> {
    return this.accounts.describe(user);
  }

  @Put('tenant')
  switchTenant(
    @CurrentUser() user: Principal,
    @CurrentSession() session: SessionRecord,
    @Body({ schema: switchTenantSchema }) input: SwitchTenantInput,
  ): Promise<Me> {
    return this.accounts.switchTenant(user, session, input.tenantId);
  }

  @Throttle({ default: { limit: 10, ttl: minutes(15) } })
  @Put('password')
  changePassword(
    @CurrentUser() user: Principal,
    @Body({ schema: changePasswordSchema }) input: ChangePasswordInput,
  ): Promise<Me> {
    return this.accounts.changePassword(user, input);
  }

  @Put('profile')
  updateProfile(
    @CurrentUser() user: Principal,
    @Body({ schema: updateProfileSchema }) input: UpdateProfileInput,
  ): Promise<UpdateProfileResult> {
    return this.profile.update(user, input);
  }

  /** Where the account is signed in. */
  @Get('sessions')
  sessions(
    @CurrentUser() user: Principal,
    @CurrentSession() session: SessionRecord,
  ): Promise<SignInSession[]> {
    return this.signInSessions.list(user, session);
  }

  /** Signs out every other device. */
  @Delete('sessions')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeOtherSessions(
    @CurrentUser() user: Principal,
    @CurrentSession() session: SessionRecord,
  ): Promise<void> {
    return this.signInSessions.revokeOthers(user, session);
  }

  /** Signs out one other device. */
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeSession(
    @CurrentUser() user: Principal,
    @CurrentSession() session: SessionRecord,
    @Param('id') id: string,
  ): Promise<void> {
    return this.signInSessions.revoke(user, session, id);
  }
}
