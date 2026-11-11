import {
  createExportSchema,
  idSchema,
  importQuerySchema,
  spreadsheetEntitySchema,
  type CreateExportInput,
  type ImportQuery,
  type SpreadsheetEntity,
  type SpreadsheetTask,
} from '@fld/shared';
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Principal } from '../auth/principal.js';
import { UploadErrorsInterceptor, type UploadedTempFile } from '../files/upload.js';
import { SpreadsheetsService } from './spreadsheets.service.js';

/**
 * Exports and imports. Each takes the permission SPREADSHEET_ENTITIES names for its model, which
 * the service checks; the list and downloads are the member's own.
 */
@ApiTags('spreadsheets')
@Can.Anyone()
@Controller('spreadsheets')
export class SpreadsheetsController {
  constructor(private readonly spreadsheets: SpreadsheetsService) {}

  @Get()
  list(@CurrentUser() user: Principal): Promise<SpreadsheetTask[]> {
    return this.spreadsheets.list(user);
  }

  @Post('exports')
  createExport(
    @CurrentUser() user: Principal,
    @Body({ schema: createExportSchema }) input: CreateExportInput,
  ): Promise<SpreadsheetTask> {
    return this.spreadsheets.createExport(user, input);
  }

  @Post('imports')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(UploadErrorsInterceptor, FileInterceptor('file'))
  createImport(
    @CurrentUser() user: Principal,
    @Query({ schema: importQuerySchema }) query: ImportQuery,
    @UploadedFile() file: UploadedTempFile | undefined,
  ): Promise<SpreadsheetTask> {
    return this.spreadsheets.createImport(user, query.entity, file);
  }

  @Get('templates/:entity')
  template(
    @CurrentUser() user: Principal,
    @Param('entity', { schema: spreadsheetEntitySchema }) entity: SpreadsheetEntity,
    @Res() response: Response,
  ): Promise<void> {
    return this.spreadsheets.sendTemplate(user, entity, response);
  }

  @Get(':id/download')
  download(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    return this.spreadsheets.download(user, id, request, response);
  }
}
