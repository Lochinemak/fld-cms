import { ConsoleLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import type { Env } from './config/env.js';
import { PlatformSettingsService } from './settings/platform-settings.service.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: new ConsoleLogger({ json: process.env.NODE_ENV === 'production' }),
  });
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  configureApp(app);
  app.enableShutdownHooks();

  const swaggerEnabled =
    config.get('SWAGGER_ENABLED', { infer: true }) ??
    config.get('NODE_ENV', { infer: true }) !== 'production';
  if (swaggerEnabled) {
    // Read once: the docs show a new name after a restart.
    const appName = await app.get(PlatformSettingsService).appName();
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle(`${appName} API`).setVersion('0.0.1').build(),
    );
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
