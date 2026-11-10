import { StandardSchemaValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Express } from 'express';
import type { Env } from './config/env.js';

/** HTTP settings shared by main.ts and the end-to-end tests. */
export function configureApp(app: INestApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const trustProxy = config.get('TRUST_PROXY', { infer: true });
  if (trustProxy !== false) {
    const server: Express = app.getHttpAdapter().getInstance();
    server.set('trust proxy', trustProxy);
  }
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  // Session cookies ride along on cross-site requests, so refuse state changes from other origins.
  app.enableCsrfProtection({ trustedOrigins: config.get('TRUSTED_ORIGINS', { infer: true }) });
}
