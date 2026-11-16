import {
  tableIdSchema,
  tablePreferenceSchema,
  type TableId,
  type TablePreference,
} from '@fld/shared';
import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { ApiTags } from '@nestjs/swagger';
import type { Principal } from '../auth/principal.js';
import { PreferencesService } from './preferences.service.js';

/** The signed-in member's own preferences in the current tenant. */
@ApiTags('preferences')
@Can.Anyone()
@Controller('preferences')
export class PreferencesController {
  constructor(private readonly preferences: PreferencesService) {}

  @Get('tables/:table')
  table(
    @CurrentUser() user: Principal,
    @Param('table', { schema: tableIdSchema }) table: TableId,
  ): Promise<TablePreference> {
    return this.preferences.table(user, table);
  }

  @Put('tables/:table')
  setTable(
    @CurrentUser() user: Principal,
    @Param('table', { schema: tableIdSchema }) table: TableId,
    @Body({ schema: tablePreferenceSchema }) preference: TablePreference,
  ): Promise<TablePreference> {
    return this.preferences.setTable(user, table, preference);
  }
}
