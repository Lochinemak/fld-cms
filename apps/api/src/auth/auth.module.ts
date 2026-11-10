import { Module } from '@nestjs/common';
import { AuthenticationStorage } from '@nestjs/authentication';
import { SettingsModule } from '../settings/settings.module.js';
import { AccountProvisioning } from './account-provisioning.js';
import { AccountService } from './account.service.js';
import { AuthController } from './auth.controller.js';
import { CredentialsService } from './credentials.service.js';
import { MeController } from './me.controller.js';
import { PasswordRecoveryService } from './password-recovery.service.js';
import { PasswordResetMailer } from './password-reset.mailer.js';
import { PrismaEmailTokenStore } from './prisma-email-token.store.js';
import { PrismaSessionStore } from './prisma-session.store.js';
import { SessionAuth } from './session-auth.provider.js';
import { TenantContextCache } from './tenant-context.cache.js';
import { TenantContextService } from './tenant-context.service.js';

@Module({
  imports: [SettingsModule],
  controllers: [AuthController, MeController],
  providers: [
    PrismaSessionStore,
    PrismaEmailTokenStore,
    SessionAuth,
    TenantContextCache,
    TenantContextService,
    CredentialsService,
    AccountService,
    AccountProvisioning,
    PasswordResetMailer,
    PasswordRecoveryService,
  ],
  exports: [TenantContextCache, CredentialsService, AccountProvisioning],
})
export class AuthModule {
  constructor(
    storage: AuthenticationStorage,
    sessions: PrismaSessionStore,
    emailTokens: PrismaEmailTokenStore,
  ) {
    storage.registerSource({ sessions, emailTokens });
  }
}
