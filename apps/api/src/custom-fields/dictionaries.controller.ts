import {
  BUILTIN_DICTIONARIES,
  createDictionaryItemSchema,
  createDictionarySchema,
  idSchema,
  updateDictionaryItemSchema,
  updateDictionarySchema,
  type CreateDictionaryInput,
  type CreateDictionaryItemInput,
  type Dictionary,
  type DictionaryItem,
  type PermissionCode,
  type UpdateDictionaryInput,
  type UpdateDictionaryItemInput,
} from '@fld/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { ApiTags } from '@nestjs/swagger';
import type { Principal } from '../auth/principal.js';
import { RequireAnyPermission, RequirePermission } from '../authz/permission.policy.js';
import { DictionariesService } from './dictionaries.service.js';

/** The pages that offer a built-in dictionary's items. */
const BUILTIN_READERS = Object.values(BUILTIN_DICTIONARIES).map(
  (dictionary) => dictionary.permission as PermissionCode,
);

@ApiTags('system')
@Controller('dictionaries')
export class DictionariesController {
  constructor(private readonly dictionaries: DictionariesService) {}

  @RequirePermission('system:dictionary')
  @Get()
  list(@CurrentUser() user: Principal): Promise<Dictionary[]> {
    return this.dictionaries.list(user);
  }

  /** A built-in dictionary's items, by its code, e.g. crm.customer-source. */
  @RequireAnyPermission('system:dictionary', ...BUILTIN_READERS)
  @Get('builtin/:code/items')
  builtinItems(
    @CurrentUser() user: Principal,
    @Param('code') code: string,
  ): Promise<DictionaryItem[]> {
    return this.dictionaries.builtinItems(user, code);
  }

  @RequirePermission('system:dictionary:update')
  @Post()
  create(
    @CurrentUser() user: Principal,
    @Body({ schema: createDictionarySchema }) input: CreateDictionaryInput,
  ): Promise<Dictionary> {
    return this.dictionaries.create(user, input);
  }

  @RequirePermission('system:dictionary:update')
  @Patch(':id')
  update(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
    @Body({ schema: updateDictionarySchema }) input: UpdateDictionaryInput,
  ): Promise<Dictionary> {
    return this.dictionaries.update(user, id, input);
  }

  @RequirePermission('system:dictionary:update')
  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
  ): Promise<void> {
    return this.dictionaries.remove(user, id);
  }

  @RequirePermission('system:dictionary:update')
  @Post(':id/items')
  addItem(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
    @Body({ schema: createDictionaryItemSchema }) input: CreateDictionaryItemInput,
  ): Promise<Dictionary> {
    return this.dictionaries.addItem(user, id, input);
  }

  @RequirePermission('system:dictionary:update')
  @Patch(':id/items/:itemId')
  updateItem(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
    @Param('itemId', { schema: idSchema }) itemId: string,
    @Body({ schema: updateDictionaryItemSchema }) input: UpdateDictionaryItemInput,
  ): Promise<Dictionary> {
    return this.dictionaries.updateItem(user, id, itemId, input);
  }
}
