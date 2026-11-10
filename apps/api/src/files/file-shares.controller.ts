import {
  createFileShareSchema,
  idSchema,
  type CreateFileShareInput,
  type FileShare,
} from '@fld/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { ApiTags } from '@nestjs/swagger';
import type { Principal } from '../auth/principal.js';
import { RequirePermission } from '../authz/permission.policy.js';
import { FileSharesService } from './file-shares.service.js';

@ApiTags('files')
@Controller('files')
export class FileSharesController {
  constructor(private readonly shares: FileSharesService) {}

  @RequirePermission('file:library:share')
  @Get(':id/shares')
  list(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
  ): Promise<FileShare[]> {
    return this.shares.list(user, id);
  }

  @RequirePermission('file:library:share')
  @Post(':id/shares')
  create(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
    @Body({ schema: createFileShareSchema }) input: CreateFileShareInput,
  ): Promise<FileShare> {
    return this.shares.create(user, id, input);
  }

  @RequirePermission('file:library:share')
  @Delete('shares/:shareId')
  @HttpCode(204)
  remove(
    @CurrentUser() user: Principal,
    @Param('shareId', { schema: idSchema }) shareId: string,
  ): Promise<void> {
    return this.shares.remove(user, shareId);
  }
}
