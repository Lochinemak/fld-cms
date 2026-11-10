import {
  attachFilesSchema,
  fileContentQuerySchema,
  idSchema,
  type AttachFilesInput,
  type Attachment,
  type FileContentQuery,
} from '@fld/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Principal } from '../auth/principal.js';
import { RequirePermission } from '../authz/permission.policy.js';
import { CustomerAttachmentsService } from './customer-attachments.service.js';

/** Adding and removing attachments counts as editing the customer. */
@ApiTags('crm')
@Controller('crm/customers/:id/attachments')
export class CustomerAttachmentsController {
  constructor(private readonly attachments: CustomerAttachmentsService) {}

  @RequirePermission('crm:customer')
  @Get()
  list(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
  ): Promise<Attachment[]> {
    return this.attachments.list(user, id);
  }

  @RequirePermission('crm:customer:update')
  @Post()
  attach(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
    @Body({ schema: attachFilesSchema }) input: AttachFilesInput,
  ): Promise<Attachment[]> {
    return this.attachments.attach(user, id, input);
  }

  @RequirePermission('crm:customer:update')
  @Delete(':fileId')
  @HttpCode(204)
  detach(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
    @Param('fileId', { schema: idSchema }) fileId: string,
  ): Promise<void> {
    return this.attachments.detach(user, id, fileId);
  }

  @RequirePermission('crm:customer')
  @Get(':fileId/content')
  content(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
    @Param('fileId', { schema: idSchema }) fileId: string,
    @Query({ schema: fileContentQuerySchema }) query: FileContentQuery,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    return this.attachments.sendContent(user, id, fileId, request, response, query.download);
  }
}
