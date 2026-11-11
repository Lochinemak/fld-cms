import {
  fileContentQuerySchema,
  idSchema,
  storedFileQuerySchema,
  updateStoredFileSchema,
  uploadFileQuerySchema,
  type FileContentQuery,
  type Page,
  type StoredFile,
  type StoredFileDetail,
  type StoredFileQuery,
  type UpdateStoredFileInput,
  type UploadFileQuery,
} from '@fld/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Principal } from '../auth/principal.js';
import { RequirePermission } from '../authz/permission.policy.js';
import { FilesService } from './files.service.js';
import { UploadErrorsInterceptor, type UploadedTempFile } from './upload.js';

@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @RequirePermission('file:library')
  @Get()
  list(
    @CurrentUser() user: Principal,
    @Query({ schema: storedFileQuerySchema }) query: StoredFileQuery,
  ): Promise<Page<StoredFile>> {
    return this.files.list(user, query);
  }

  // Above files/:id, which would otherwise take it.
  @RequirePermission('file:library')
  @Get('recent')
  recent(@CurrentUser() user: Principal): Promise<StoredFile[]> {
    return this.files.recent(user);
  }

  /** One file per request, in the multipart field `file`. */
  @RequirePermission('file:library:upload')
  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(UploadErrorsInterceptor, FileInterceptor('file'))
  upload(
    @CurrentUser() user: Principal,
    @Query({ schema: uploadFileQuerySchema }) query: UploadFileQuery,
    @UploadedFile() file: UploadedTempFile | undefined,
  ): Promise<StoredFile> {
    return this.files.upload(user, query.folderId, file);
  }

  @RequirePermission('file:library')
  @Get(':id')
  get(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
  ): Promise<StoredFileDetail> {
    return this.files.get(user, id);
  }

  @RequirePermission('file:library:edit')
  @Patch(':id')
  update(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
    @Body({ schema: updateStoredFileSchema }) input: UpdateStoredFileInput,
  ): Promise<StoredFile> {
    return this.files.update(user, id, input);
  }

  @RequirePermission('file:library:delete')
  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
  ): Promise<void> {
    return this.files.remove(user, id);
  }

  @RequirePermission('file:library')
  @Get(':id/content')
  content(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
    @Query({ schema: fileContentQuerySchema }) query: FileContentQuery,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    return this.files.sendContent(user, id, request, response, query.download);
  }

  @RequirePermission('file:library')
  @Get(':id/versions/:versionId/content')
  versionContent(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
    @Param('versionId', { schema: idSchema }) versionId: string,
    @Query({ schema: fileContentQuerySchema }) query: FileContentQuery,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    return this.files.sendVersionContent(user, id, versionId, request, response, query.download);
  }

  /** Replaces the contents with an upload of the same type, as a new version. */
  @RequirePermission('file:library:replace')
  @Post(':id/versions')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(UploadErrorsInterceptor, FileInterceptor('file'))
  replace(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
    @UploadedFile() file: UploadedTempFile | undefined,
  ): Promise<StoredFileDetail> {
    return this.files.replace(user, id, file);
  }

  @RequirePermission('file:library:replace')
  @Post(':id/versions/:versionId/restore')
  @HttpCode(200)
  restore(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
    @Param('versionId', { schema: idSchema }) versionId: string,
  ): Promise<StoredFileDetail> {
    return this.files.restore(user, id, versionId);
  }
}
