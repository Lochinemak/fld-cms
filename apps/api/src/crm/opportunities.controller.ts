import {
  createOpportunitySchema,
  idSchema,
  opportunityQuerySchema,
  transferSchema,
  updateOpportunitySchema,
  type CreateOpportunityInput,
  type Opportunity,
  type OpportunityPage,
  type OpportunityQuery,
  type TransferInput,
  type UpdateOpportunityInput,
} from '@fld/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { ApiTags } from '@nestjs/swagger';
import type { Principal } from '../auth/principal.js';
import { RequirePermission } from '../authz/permission.policy.js';
import { OpportunitiesService } from './opportunities.service.js';

@ApiTags('crm')
@Controller('crm/opportunities')
export class OpportunitiesController {
  constructor(private readonly opportunities: OpportunitiesService) {}

  @RequirePermission('crm:opportunity')
  @Get()
  list(
    @CurrentUser() user: Principal,
    @Query({ schema: opportunityQuerySchema }) query: OpportunityQuery,
  ): Promise<OpportunityPage> {
    return this.opportunities.list(user, query);
  }

  @RequirePermission('crm:opportunity:create')
  @Post()
  create(
    @CurrentUser() user: Principal,
    @Body({ schema: createOpportunitySchema }) input: CreateOpportunityInput,
  ): Promise<Opportunity> {
    return this.opportunities.create(user, input);
  }

  @RequirePermission('crm:opportunity:update')
  @Patch(':id')
  update(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
    @Body({ schema: updateOpportunitySchema }) input: UpdateOpportunityInput,
  ): Promise<Opportunity> {
    return this.opportunities.update(user, id, input);
  }

  @RequirePermission('crm:opportunity:transfer')
  @Post(':id/transfer')
  @HttpCode(200)
  transfer(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
    @Body({ schema: transferSchema }) input: TransferInput,
  ): Promise<Opportunity> {
    return this.opportunities.transfer(user, id, input);
  }

  @RequirePermission('crm:opportunity:delete')
  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
  ): Promise<void> {
    return this.opportunities.remove(user, id);
  }
}
