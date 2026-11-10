import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

/**
 * The whole API, configured as main.ts does, on the test database. `override` may replace
 * providers, such as the mail transport.
 */
export async function createTestApp(
  override: (builder: TestingModuleBuilder) => TestingModuleBuilder = (builder) => builder,
): Promise<INestApplication<App>> {
  const moduleRef = await override(Test.createTestingModule({ imports: [AppModule] })).compile();
  // Errors only: the bootstrap warning carries the generated super admin password.
  const app = moduleRef.createNestApplication<INestApplication<App>>({ logger: ['error'] });
  configureApp(app);
  await app.init();
  return app;
}
