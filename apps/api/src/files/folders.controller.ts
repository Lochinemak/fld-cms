import {
  createFileFolderSchema,
  fileFolderQuerySchema,
  idSchema,
  updateFileFolderSchema,
  type CreateFileFolderInput,
  type FileFolder,
  type FileFolderDetail,
  type FileFolderQuery,
  type UpdateFileFolderInput,
} from '@fld/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { ApiTags } from '@nestjs/swagger';
import type { Principal } from '../auth/principal.js';
import { RequirePermission } from '../authz/permission.policy.js';
import { FoldersService } from './folders.service.js';

@ApiTags('files')
@Controller('files/folders')
export class FoldersController {
  constructor(private readonly folders: FoldersService) {}

  @RequirePermission('file:library')
  @Get()
  list(
    @CurrentUser() user: Principal,
    @Query({ schema: fileFolderQuerySchema }) query: FileFolderQuery,
  ): Promise<FileFolder[]> {
    return this.folders.list(user, query);
  }

  @RequirePermission('file:library')
  @Get(':id')
  get(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
  ): Promise<FileFolderDetail> {
    return this.folders.get(user, id);
  }

  @RequirePermission('file:library:folder')
  @Post()
  create(
    @CurrentUser() user: Principal,
    @Body({ schema: createFileFolderSchema }) input: CreateFileFolderInput,
  ): Promise<FileFolder> {
    return this.folders.create(user, input);
  }

  @RequirePermission('file:library:edit')
  @Patch(':id')
  update(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
    @Body({ schema: updateFileFolderSchema }) input: UpdateFileFolderInput,
  ): Promise<FileFolder> {
    return this.folders.update(user, id, input);
  }

  @RequirePermission('file:library:delete')
  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
  ): Promise<void> {
    return this.folders.remove(user, id);
  }
}
