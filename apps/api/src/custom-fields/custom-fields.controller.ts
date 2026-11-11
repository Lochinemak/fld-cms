import {
  CUSTOM_FIELD_ENTITIES,
  createCustomFieldSchema,
  customFieldQuerySchema,
  idSchema,
  updateCustomFieldSchema,
  type CreateCustomFieldInput,
  type CustomField,
  type CustomFieldQuery,
  type PermissionCode,
  type UpdateCustomFieldInput,
} from '@fld/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { ApiTags } from '@nestjs/swagger';
import type { Principal } from '../auth/principal.js';
import { RequireAnyPermission, RequirePermission } from '../authz/permission.policy.js';
import { CustomFieldsService } from './custom-fields.service.js';

/** The pages of the models with custom fields: each reads its own model's fields. */
const ENTITY_PAGES = Object.values(CUSTOM_FIELD_ENTITIES).map(
  (entity) => entity.permission as PermissionCode,
);

@ApiTags('system')
@Controller('custom-fields')
export class CustomFieldsController {
  constructor(private readonly fields: CustomFieldsService) {}

  /** A model's fields with their options, for its pages and for managing them. */
  @RequireAnyPermission('system:custom-field', ...ENTITY_PAGES)
  @Get()
  list(
    @CurrentUser() user: Principal,
    @Query({ schema: customFieldQuerySchema }) query: CustomFieldQuery,
  ): Promise<CustomField[]> {
    return this.fields.list(user, query.entity);
  }

  @RequirePermission('system:custom-field:update')
  @Post()
  create(
    @CurrentUser() user: Principal,
    @Body({ schema: createCustomFieldSchema }) input: CreateCustomFieldInput,
  ): Promise<CustomField> {
    return this.fields.create(user, input);
  }

  @RequirePermission('system:custom-field:update')
  @Patch(':id')
  update(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
    @Body({ schema: updateCustomFieldSchema }) input: UpdateCustomFieldInput,
  ): Promise<CustomField> {
    return this.fields.update(user, id, input);
  }

  @RequirePermission('system:custom-field:update')
  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
  ): Promise<void> {
    return this.fields.remove(user, id);
  }
}
