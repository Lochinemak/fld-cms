import {
  createCustomerSchema,
  customerQuerySchema,
  idSchema,
  transferSchema,
  updateCustomerSchema,
  type CreateCustomerInput,
  type Customer,
  type CustomerQuery,
  type Page,
  type TransferInput,
  type UpdateCustomerInput,
} from '@fld/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { ApiTags } from '@nestjs/swagger';
import type { Principal } from '../auth/principal.js';
import { RequirePermission } from '../authz/permission.policy.js';
import { CustomersService } from './customers.service.js';

@ApiTags('crm')
@Controller('crm/customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @RequirePermission('crm:customer')
  @Get()
  list(
    @CurrentUser() user: Principal,
    @Query({ schema: customerQuerySchema }) query: CustomerQuery,
  ): Promise<Page<Customer>> {
    return this.customers.list(user, query);
  }

  @RequirePermission('crm:customer')
  @Get(':id')
  get(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
  ): Promise<Customer> {
    return this.customers.get(user, id);
  }

  @RequirePermission('crm:customer:create')
  @Post()
  create(
    @CurrentUser() user: Principal,
    @Body({ schema: createCustomerSchema }) input: CreateCustomerInput,
  ): Promise<Customer> {
    return this.customers.create(user, input);
  }

  @RequirePermission('crm:customer:update')
  @Patch(':id')
  update(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
    @Body({ schema: updateCustomerSchema }) input: UpdateCustomerInput,
  ): Promise<Customer> {
    return this.customers.update(user, id, input);
  }

  @RequirePermission('crm:customer:transfer')
  @Post(':id/transfer')
  @HttpCode(200)
  transfer(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
    @Body({ schema: transferSchema }) input: TransferInput,
  ): Promise<Customer> {
    return this.customers.transfer(user, id, input);
  }

  @RequirePermission('crm:customer:delete')
  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: Principal,
    @Param('id', { schema: idSchema }) id: string,
  ): Promise<void> {
    return this.customers.remove(user, id);
  }
}
