import { Module } from '@nestjs/common';
import { AuthenticationStorage } from '@nestjs/authentication';
import { AccountProvisioning } from './account-provisioning.js';
import { AccountService } from './account.service.js';
import { AuthController } from './auth.controller.js';
import { CredentialsService } from './credentials.service.js';
import { MeController } from './me.controller.js';
import { PrismaSessionStore } from './prisma-session.store.js';
import { SessionAuth } from './session-auth.provider.js';
import { TenantContextCache } from './tenant-context.cache.js';
import { TenantContextService } from './tenant-context.service.js';

@Module({
  controllers: [AuthController, MeController],
  providers: [
    PrismaSessionStore,
    SessionAuth,
    TenantContextCache,
    TenantContextService,
    CredentialsService,
    AccountService,
    AccountProvisioning,
  ],
  exports: [TenantContextCache, CredentialsService, AccountProvisioning],
})
export class AuthModule {
  constructor(storage: AuthenticationStorage, sessions: PrismaSessionStore) {
    storage.registerSource({ sessions });
  }
}
