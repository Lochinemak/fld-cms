import {
  createMemberSchema,
  idSchema,
  memberQuerySchema,
  updateMemberSchema,
  type CreateMemberInput,
  type CreateMemberResult,
  type Member,
  type MemberQuery,
  type Page,
  type ResetMemberPasswordResult,
  type UpdateMemberInput,
} from '@fld/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { ApiTags } from '@nestjs/swagger';
import type { Principal } from '../auth/principal.js';
import { RequirePermission } from '../authz/permission.policy.js';
import { MembersService } from './members.service.js';

@ApiTags('system')
@Controller('system/members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @RequirePermission('system:member')
  @Get()
  list(
    @CurrentUser() user: Principal,
    @Query({ schema: memberQuerySchema }) query: MemberQuery,
  ): Promise<Page<Member>> {
    return this.members.list(user, query);
  }

  @RequirePermission('system:member:create')
  @Post()
  create(
    @CurrentUser() user: Principal,
    @Body({ schema: createMemberSchema }) input: CreateMemberInput,
  ): Promise<CreateMemberResult> {
    return this.members.create(user, input);
  }

  @RequirePermission('system:member:update')
  @Patch(':id')
  update(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
    @Body({ schema: updateMemberSchema }) input: UpdateMemberInput,
  ): Promise<Member> {
    return this.members.update(user, id, input);
  }

  @RequirePermission('system:member:remove')
  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
  ): Promise<void> {
    return this.members.remove(user, id);
  }

  @RequirePermission('system:member:reset-password')
  @Post(':id/reset-password')
  @HttpCode(200)
  resetPassword(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
  ): Promise<ResetMemberPasswordResult> {
    return this.members.resetPassword(user, id);
  }

  @RequirePermission('system:member:unlock')
  @Post(':id/unlock')
  @HttpCode(200)
  unlock(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
  ): Promise<Member> {
    return this.members.unlock(user, id);
  }

  @RequirePermission('system:member:reset-mfa')
  @Post(':id/reset-mfa')
  @HttpCode(200)
  resetMfa(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
  ): Promise<Member> {
    return this.members.resetMfa(user, id);
  }
}
