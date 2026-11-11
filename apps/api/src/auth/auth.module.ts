import { Module } from '@nestjs/common';
import { AuthenticationStorage } from '@nestjs/authentication';
import { SettingsModule } from '../settings/settings.module.js';
import { AccountProvisioning } from './account-provisioning.js';
import { AccountService } from './account.service.js';
import { AuthController } from './auth.controller.js';
import { CredentialsService } from './credentials.service.js';
import { LogtoAccountResolver } from './logto-account.resolver.js';
import { LogtoController } from './logto.controller.js';
import { MeController } from './me.controller.js';
import { PrismaMfaStore } from './mfa.store.js';
import { MfaSetupService } from './mfa-setup.service.js';
import { PasswordRecoveryService } from './password-recovery.service.js';
import { PasswordResetMailer } from './password-reset.mailer.js';
import { PrismaEmailTokenStore } from './prisma-email-token.store.js';
import { PrismaSessionStore } from './prisma-session.store.js';
import { ProfileService } from './profile.service.js';
import { RedisOidcStateStore } from './redis-oidc-state.store.js';
import { RunAsService } from './run-as.service.js';
import { SessionAuth } from './session-auth.provider.js';
import { SignInSessionsService } from './sign-in-sessions.service.js';
import { TenantContextCache } from './tenant-context.cache.js';
import { TenantContextService } from './tenant-context.service.js';

@Module({
  imports: [SettingsModule],
  controllers: [AuthController, LogtoController, MeController],
  providers: [
    PrismaSessionStore,
    PrismaEmailTokenStore,
    PrismaMfaStore,
    MfaSetupService,
    RedisOidcStateStore,
    SessionAuth,
    LogtoAccountResolver,
    TenantContextCache,
    TenantContextService,
    CredentialsService,
    AccountService,
    ProfileService,
    AccountProvisioning,
    PasswordResetMailer,
    PasswordRecoveryService,
    SignInSessionsService,
    RunAsService,
  ],
  exports: [
    TenantContextCache,
    CredentialsService,
    AccountProvisioning,
    MfaSetupService,
    RunAsService,
  ],
})
export class AuthModule {
  constructor(
    storage: AuthenticationStorage,
    sessions: PrismaSessionStore,
    emailTokens: PrismaEmailTokenStore,
    oidcStates: RedisOidcStateStore,
    mfa: PrismaMfaStore,
  ) {
    storage.registerSource({ sessions, emailTokens, oidcStates, mfa });
  }
}
