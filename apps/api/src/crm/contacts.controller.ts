import {
  contactQuerySchema,
  createContactSchema,
  idSchema,
  updateContactSchema,
  type Contact,
  type ContactQuery,
  type CreateContactInput,
  type Page,
  type UpdateContactInput,
} from '@fld/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { ApiTags } from '@nestjs/swagger';
import type { Principal } from '../auth/principal.js';
import { RequirePermission } from '../authz/permission.policy.js';
import { ContactsService } from './contacts.service.js';

@ApiTags('crm')
@Controller('crm/contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @RequirePermission('crm:contact')
  @Get()
  list(
    @CurrentUser() user: Principal,
    @Query({ schema: contactQuerySchema }) query: ContactQuery,
  ): Promise<Page<Contact>> {
    return this.contacts.list(user, query);
  }

  @RequirePermission('crm:contact:create')
  @Post()
  create(
    @CurrentUser() user: Principal,
    @Body({ schema: createContactSchema }) input: CreateContactInput,
  ): Promise<Contact> {
    return this.contacts.create(user, input);
  }

  @RequirePermission('crm:contact:update')
  @Patch(':id')
  update(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
    @Body({ schema: updateContactSchema }) input: UpdateContactInput,
  ): Promise<Contact> {
    return this.contacts.update(user, id, input);
  }

  @RequirePermission('crm:contact:delete')
  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
  ): Promise<void> {
    return this.contacts.remove(user, id);
  }
}
