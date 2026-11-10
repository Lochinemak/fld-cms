import { PASSWORD_RESET_MINUTES } from '@fld/shared';
import { Module } from '@nestjs/common';
import { AuthenticationModule } from '@nestjs/authentication';
import { AuthorizationModule } from '@nestjs/authorization';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AccountsModule } from './accounts/accounts.module.js';
import { AuthModule } from './auth/auth.module.js';
import { RESET_PASSWORD_PATH } from './auth/password-reset.mailer.js';
import { AuthzModule } from './authz/authz.module.js';
import { AppConfigModule } from './config/app-config.module.js';
import type { Env } from './config/env.js';
import { CrmModule } from './crm/crm.module.js';
import { DepartmentsModule } from './departments/departments.module.js';
import { FilesModule } from './files/files.module.js';
import { HealthModule } from './health/health.module.js';
import { MembersModule } from './members/members.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { RolesModule } from './roles/roles.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { SnowflakeModule } from './snowflake/snowflake.module.js';
import { StorageModule } from './storage/storage.module.js';
import { TenantsModule } from './tenants/tenants.module.js';
import { ThrottleModule } from './throttle/throttle.module.js';

// Global guards run in import order, after the root module's own: rate limiting first, then
// authentication, the tenant check (AuthzModule) and authorization, which must come after
// authentication.
@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    SnowflakeModule,
    StorageModule,
    ThrottleModule,
    AuthenticationModule.forRootAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        session: {
          absoluteTtl: '7d',
          idleTtl: '1d',
          cookie: { secure: config.get('SESSION_COOKIE_SECURE', { infer: true }) },
          trustedOrigins: config.get('TRUSTED_ORIGINS', { infer: true }),
          metadata: (request) => ({
            userAgent: request.headers['user-agent'],
            ip: request.ip,
          }),
        },
        // PasswordResetMailer puts the site address of the moment in front of the path.
        passwordReset: {
          url: `http://localhost${RESET_PASSWORD_PATH}`,
          ttl: `${PASSWORD_RESET_MINUTES}m`,
        },
      }),
    }),
    AuthModule,
    AuthzModule,
    AuthorizationModule.forRoot(),
    HealthModule,
    SettingsModule,
    AccountsModule,
    TenantsModule,
    DepartmentsModule,
    RolesModule,
    MembersModule,
    CrmModule,
    FilesModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
