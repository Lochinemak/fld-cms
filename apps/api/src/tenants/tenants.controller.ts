import {
  createTenantSchema,
  idSchema,
  pageQuerySchema,
  resetTenantAdminSchema,
  updateTenantSchema,
  type CreateTenantInput,
  type CreateTenantResult,
  type Page,
  type PageQuery,
  type ResetTenantAdminInput,
  type Tenant,
  type TenantAdmin,
  type UpdateTenantInput,
} from '@fld/shared';
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../authz/permission.policy.js';
import { TenantsService } from './tenants.service.js';

/** Tenant management, which only the system tenant's permissions grant. */
@ApiTags('system')
@Controller('system/tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @RequirePermission('system:tenant')
  @Get()
  list(@Query({ schema: pageQuerySchema }) query: PageQuery): Promise<Page<Tenant>> {
    return this.tenants.list(query);
  }

  @RequirePermission('system:tenant:create')
  @Post()
  create(
    @Body({ schema: createTenantSchema }) input: CreateTenantInput,
  ): Promise<CreateTenantResult> {
    return this.tenants.create(input);
  }

  @RequirePermission('system:tenant:update')
  @Patch(':id')
  update(
    @Param('id', { schema: idSchema }) id: string,
    @Body({ schema: updateTenantSchema }) input: UpdateTenantInput,
  ): Promise<Tenant> {
    return this.tenants.update(id, input);
  }

  @RequirePermission('system:tenant:update')
  @Post(':id/admin')
  resetAdmin(
    @Param('id', { schema: idSchema }) id: string,
    @Body({ schema: resetTenantAdminSchema }) input: ResetTenantAdminInput,
  ): Promise<TenantAdmin> {
    return this.tenants.resetAdmin(id, input);
  }
}
