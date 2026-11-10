import { ownerQuerySchema, type OwnerOption, type OwnerQuery } from '@fld/shared';
import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { ApiTags } from '@nestjs/swagger';
import type { Principal } from '../auth/principal.js';
import { RequireAnyPermission } from '../authz/permission.policy.js';
import { OwnersService } from './owners.service.js';

@ApiTags('crm')
@Controller('crm/owners')
export class OwnersController {
  constructor(private readonly owners: OwnersService) {}

  /** Members the user may hand customers or opportunities to. */
  @RequireAnyPermission('crm:customer:transfer', 'crm:opportunity:transfer')
  @Get()
  list(
    @CurrentUser() user: Principal,
    @Query({ schema: ownerQuerySchema }) query: OwnerQuery,
  ): Promise<OwnerOption[]> {
    return this.owners.list(user, query);
  }
}
