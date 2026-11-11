import {
  confirmMfaSetupSchema,
  disableMfaSchema,
  startMfaSetupSchema,
  changePasswordSchema,
  switchTenantSchema,
  updateProfileSchema,
  type ChangePasswordInput,
  type ConfirmMfaSetupInput,
  type DisableMfaInput,
  type MfaSetup,
  type MfaStatus,
  type RecoveryCodes,
  type StartMfaSetupInput,
  type Me,
  type SignInSession,
  type SwitchTenantInput,
  type UpdateProfileInput,
  type UpdateProfileResult,
} from '@fld/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import {
  Authenticate,
  CurrentSession,
  CurrentUser,
  type SessionRecord,
} from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { ApiTags } from '@nestjs/swagger';
import { minutes, Throttle } from '@nestjs/throttler';
import { AccountRoute } from '../authz/account-route.decorator.js';
import { AccountService } from './account.service.js';
import { MfaSetupService } from './mfa-setup.service.js';
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
    private readonly mfa: MfaSetupService,
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

  /** Whether two-step sign-in is on, and how many recovery codes are left. */
  @Get('mfa')
  mfaStatus(@CurrentUser() user: Principal): Promise<MfaStatus> {
    return this.mfa.status(user.id);
  }

  /** A secret for the authenticator app, with the password. */
  @Throttle({ default: { limit: 10, ttl: minutes(15) } })
  @Post('mfa/setup')
  @HttpCode(HttpStatus.OK)
  startMfaSetup(
    @CurrentUser() user: Principal,
    @Body({ schema: startMfaSetupSchema }) input: StartMfaSetupInput,
  ): Promise<MfaSetup> {
    return this.mfa.start(user, input.currentPassword);
  }

  /** Turns two-step sign-in on with a code from the app: the recovery codes, this once. */
  @Throttle({ default: { limit: 10, ttl: minutes(15) } })
  @Post('mfa/confirm')
  @HttpCode(HttpStatus.OK)
  confirmMfaSetup(
    @CurrentUser() user: Principal,
    @Body({ schema: confirmMfaSetupSchema }) input: ConfirmMfaSetupInput,
  ): Promise<RecoveryCodes> {
    return this.mfa.confirm(user, input.code);
  }

  /** New recovery codes in place of the old ones. */
  @Authenticate({ mfa: true })
  @Post('mfa/recovery-codes')
  @HttpCode(HttpStatus.OK)
  renewRecoveryCodes(@CurrentUser() user: Principal): Promise<RecoveryCodes> {
    return this.mfa.renewRecoveryCodes(user);
  }

  /** Turns two-step sign-in off, with the password. */
  @Authenticate({ mfa: true })
  @Throttle({ default: { limit: 10, ttl: minutes(15) } })
  @Post('mfa/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  disableMfa(
    @CurrentUser() user: Principal,
    @Body({ schema: disableMfaSchema }) input: DisableMfaInput,
  ): Promise<void> {
    return this.mfa.disable(user, input.currentPassword);
  }
}
