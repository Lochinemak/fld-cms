import {
  idSchema,
  pageQuerySchema,
  type Page,
  type PageQuery,
  type PlatformAccount,
  type ResetAccountPasswordResult,
} from '@fld/shared';
import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { ApiTags } from '@nestjs/swagger';
import type { Principal } from '../auth/principal.js';
import { RequirePermission } from '../authz/permission.policy.js';
import { AccountsService } from './accounts.service.js';

/** The platform's accounts, which only the system tenant's permissions grant. */
@ApiTags('system')
@Controller('system/accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @RequirePermission('system:account')
  @Get()
  list(@Query({ schema: pageQuerySchema }) query: PageQuery): Promise<Page<PlatformAccount>> {
    return this.accounts.list(query);
  }

  @RequirePermission('system:account:reset-password')
  @Post(':id/reset-password')
  @HttpCode(200)
  resetPassword(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
  ): Promise<ResetAccountPasswordResult> {
    return this.accounts.resetPassword(user, id);
  }

  @RequirePermission('system:account:unlock')
  @Post(':id/unlock')
  @HttpCode(200)
  unlock(@Param('id', { schema: idSchema }) id: string): Promise<PlatformAccount> {
    return this.accounts.unlock(id);
  }
}
