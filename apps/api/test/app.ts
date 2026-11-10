import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

/** The whole API, configured as main.ts does, on the test database. */
export async function createTestApp(): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  // Errors only: the bootstrap warning carries the generated super admin password.
  const app = moduleRef.createNestApplication<INestApplication<App>>({ logger: ['error'] });
  configureApp(app);
  await app.init();
  return app;
}
