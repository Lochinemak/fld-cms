import {
  changePasswordSchema,
  switchTenantSchema,
  type ChangePasswordInput,
  type Me,
  type SwitchTenantInput,
} from '@fld/shared';
import { Body, Controller, Get, Put } from '@nestjs/common';
import { CurrentSession, CurrentUser, type SessionRecord } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { ApiTags } from '@nestjs/swagger';
import { minutes, Throttle } from '@nestjs/throttler';
import { AccountRoute } from '../authz/account-route.decorator.js';
import { AccountService } from './account.service.js';
import type { Principal } from './principal.js';

@ApiTags('me')
@AccountRoute()
@Can.Anyone()
@Controller('me')
export class MeController {
  constructor(private readonly accounts: AccountService) {}

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
}
