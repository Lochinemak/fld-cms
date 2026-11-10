import { Global, Module } from '@nestjs/common';
import { AuthenticationContext } from '@nestjs/authentication';
import { APP_GUARD } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service.js';
import { PermissionPolicy } from './permission.policy.js';
import { TenantConsistencyGuard } from './tenant-consistency.guard.js';
import { createTenantPrisma, TENANT_PRISMA } from './tenant-prisma.js';

@Global()
@Module({
  providers: [
    PermissionPolicy,
    { provide: APP_GUARD, useClass: TenantConsistencyGuard },
    {
      provide: TENANT_PRISMA,
      inject: [PrismaService, AuthenticationContext],
      useFactory: createTenantPrisma,
    },
  ],
  exports: [PermissionPolicy, TENANT_PRISMA],
})
export class AuthzModule {}
