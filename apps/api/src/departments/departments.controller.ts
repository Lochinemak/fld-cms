import {
  createDepartmentSchema,
  idSchema,
  updateDepartmentSchema,
  type CreateDepartmentInput,
  type Department,
  type UpdateDepartmentInput,
} from '@fld/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { ApiTags } from '@nestjs/swagger';
import type { Principal } from '../auth/principal.js';
import { RequireAnyPermission, RequirePermission } from '../authz/permission.policy.js';
import { DepartmentsService } from './departments.service.js';

@ApiTags('system')
@Controller('system/depts')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @RequireAnyPermission('system:dept', 'system:member', 'system:role')
  @Get()
  list(): Promise<Department[]> {
    return this.departments.list();
  }

  @RequirePermission('system:dept:create')
  @Post()
  create(
    @CurrentUser() user: Principal,
    @Body({ schema: createDepartmentSchema }) input: CreateDepartmentInput,
  ): Promise<Department> {
    return this.departments.create(user, input);
  }

  @RequirePermission('system:dept:update')
  @Patch(':id')
  update(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
    @Body({ schema: updateDepartmentSchema }) input: UpdateDepartmentInput,
  ): Promise<Department> {
    return this.departments.update(user, id, input);
  }

  @RequirePermission('system:dept:delete')
  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
  ): Promise<void> {
    return this.departments.remove(user, id);
  }
}
