import { healthCheckSchema } from '@fld/shared';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';

// Needs the local Postgres and Redis from compose.yaml (`pnpm infra:up`).
describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health reports database and redis as up', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    const body = healthCheckSchema.parse(res.body);

    expect(body.status).toBe('ok');
    expect(body.details['database']?.status).toBe('up');
    expect(body.details['redis']?.status).toBe('up');
  });
});
