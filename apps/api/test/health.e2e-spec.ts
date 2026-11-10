import { healthCheckSchema } from '@fld/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createTestApp } from './app.js';

// Needs the local Postgres and Redis from compose.yaml (`pnpm infra:up`).
describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health reports database and redis as up, without signing in', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    const body = healthCheckSchema.parse(res.body);

    expect(body.status).toBe('ok');
    expect(body.details['database']?.status).toBe('up');
    expect(body.details['redis']?.status).toBe('up');
  });
});
