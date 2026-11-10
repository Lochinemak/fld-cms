import {
  createFollowUpSchema,
  followUpQuerySchema,
  idSchema,
  type CreateFollowUpInput,
  type FollowUp,
  type FollowUpQuery,
  type Page,
} from '@fld/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { ApiTags } from '@nestjs/swagger';
import type { Principal } from '../auth/principal.js';
import { RequirePermission } from '../authz/permission.policy.js';
import { FollowUpsService } from './follow-ups.service.js';

@ApiTags('crm')
@Controller('crm/follow-ups')
export class FollowUpsController {
  constructor(private readonly followUps: FollowUpsService) {}

  @RequirePermission('crm:follow-up')
  @Get()
  list(
    @CurrentUser() user: Principal,
    @Query({ schema: followUpQuerySchema }) query: FollowUpQuery,
  ): Promise<Page<FollowUp>> {
    return this.followUps.list(user, query);
  }

  @RequirePermission('crm:follow-up:create')
  @Post()
  create(
    @CurrentUser() user: Principal,
    @Body({ schema: createFollowUpSchema }) input: CreateFollowUpInput,
  ): Promise<FollowUp> {
    return this.followUps.create(user, input);
  }

  @RequirePermission('crm:follow-up:delete')
  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
  ): Promise<void> {
    return this.followUps.remove(user, id);
  }
}
