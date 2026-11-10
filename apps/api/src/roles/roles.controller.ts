import {
  createRoleSchema,
  idSchema,
  updateRoleSchema,
  type CreateRoleInput,
  type Role,
  type UpdateRoleInput,
} from '@fld/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { ApiTags } from '@nestjs/swagger';
import type { Principal } from '../auth/principal.js';
import { RequireAnyPermission, RequirePermission } from '../authz/permission.policy.js';
import { RolesService } from './roles.service.js';

@ApiTags('system')
@Controller('system/roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @RequireAnyPermission('system:role', 'system:member')
  @Get()
  list(@CurrentUser() user: Principal): Promise<Role[]> {
    return this.roles.list(user);
  }

  @RequirePermission('system:role:create')
  @Post()
  create(
    @CurrentUser() user: Principal,
    @Body({ schema: createRoleSchema }) input: CreateRoleInput,
  ): Promise<Role> {
    return this.roles.create(user, input);
  }

  @RequirePermission('system:role:update')
  @Put(':id')
  update(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
    @Body({ schema: updateRoleSchema }) input: UpdateRoleInput,
  ): Promise<Role> {
    return this.roles.update(user, id, input);
  }

  @RequirePermission('system:role:delete')
  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
  ): Promise<void> {
    return this.roles.remove(user, id);
  }
}
