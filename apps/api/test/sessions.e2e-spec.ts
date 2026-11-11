import { auditLogPageSchema, signInSessionSchema } from '@fld/shared';
import type { INestApplication } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { z } from 'zod';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { SnowflakeService } from '../src/snowflake/snowflake.service.js';
import { createTestApp } from './app.js';

type TestAgent = ReturnType<typeof request.agent>;

const PASSWORD = 'sess-test-password';
const SYSTEM_TENANT = 1n;
const sessionsSchema = z.array(signInSessionSchema);

// Where an account is signed in, and signing devices out. It runs on accounts of its own (all
// named sess-*), which it removes afterwards.
describe('Sign-in sessions (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const ids: Record<string, string> = {};

  const signIn = async (account: string, userAgent: string) => {
    const agent = request.agent(app.getHttpServer()).set('User-Agent', userAgent);
    await agent.post('/api/auth/sign-in').send({ account, password: PASSWORD }).expect(200);
    return agent;
  };
  const sessions = async (agent: TestAgent) =>
    sessionsSchema.parse((await agent.get('/api/me/sessions').expect(200)).body);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const snowflake = app.get(SnowflakeService);
    const passwordHash = await new PasswordHasher().hash(PASSWORD);
    for (const username of ['sess-admin', 'sess-ann']) {
      const user = await prisma.user.create({
        data: { id: snowflake.next(), username, displayName: username, passwordHash },
      });
      ids[username] = user.id.toString();
    }
    const superAdminRole = await prisma.role.findFirstOrThrow({
      where: { tenantId: SYSTEM_TENANT, builtin: true },
    });
    const memberId = snowflake.next();
    await prisma.tenantMember.create({
      data: { id: memberId, tenantId: SYSTEM_TENANT, userId: BigInt(ids['sess-admin']!) },
    });
    await prisma.memberRole.create({
      data: { tenantId: SYSTEM_TENANT, memberId, roleId: superAdminRole.id },
    });
  });

  beforeEach(async () => {
    const redis = app.get(RedisService);
    const keys = await redis.keys('fld:throttle:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  afterAll(async () => {
    const users = Object.values(ids);
    await prisma.session.deleteMany({ where: { userId: { in: users } } });
    await prisma.auditLog.deleteMany({
      where: { actorUsername: { startsWith: 'sess-' } },
    });
    await prisma.user.deleteMany({ where: { id: { in: users.map((id) => BigInt(id)) } } });
    await app.close();
  });

  it('lists where the account is signed in, the current device first', async () => {
    const laptop = await signIn('sess-ann', 'Laptop');
    await signIn('sess-ann', 'Phone');
    const listed = await sessions(laptop);
    expect(listed).toHaveLength(2);
    expect(listed[0]).toMatchObject({ current: true, method: 'password', userAgent: 'Laptop' });
    expect(listed[1]).toMatchObject({ current: false, userAgent: 'Phone' });
  });

  it('signs out one other device, never the current one through this', async () => {
    const laptop = await signIn('sess-ann', 'Laptop 2');
    const tablet = await signIn('sess-ann', 'Tablet');
    const [current, ...others] = await sessions(laptop);
    await laptop.delete(`/api/me/sessions/${current!.id}`).expect(400);

    const tabletSession = others.find((session) => session.userAgent === 'Tablet')!;
    await laptop.delete(`/api/me/sessions/${tabletSession.id}`).expect(204);
    await tablet.get('/api/me').expect(401);
    await laptop.get('/api/me').expect(200);
    // Gone already, or never this account's.
    await laptop.delete(`/api/me/sessions/${tabletSession.id}`).expect(404);
  });

  it('signs out every other device at once, and records it', async () => {
    const laptop = await signIn('sess-ann', 'Laptop 3');
    const phone = await signIn('sess-ann', 'Phone 2');
    await laptop.delete('/api/me/sessions').expect(204);
    await phone.get('/api/me').expect(401);
    expect(await sessions(laptop)).toEqual([expect.objectContaining({ current: true })]);
    expect(
      await prisma.auditLog.count({
        where: { action: 'auth.revoke-session', accountId: BigInt(ids['sess-ann']!) },
      }),
    ).toBeGreaterThanOrEqual(2);
  });

  it('lets the platform sign an account out everywhere, keeping its password', async () => {
    const admin = await signIn('sess-admin', 'Admin');
    const ann = await signIn('sess-ann', 'Laptop 4');
    await ann.post(`/api/system/accounts/${ids['sess-admin']}/sign-out`).expect(403);

    const signedOut = await admin
      .post(`/api/system/accounts/${ids['sess-ann']}/sign-out`)
      .expect(204);
    expect(signedOut.headers['x-request-id']).toBeTruthy();
    await ann.get('/api/me').expect(401);
    await signIn('sess-ann', 'Laptop 5');

    const logs = auditLogPageSchema.parse(
      (await admin.get('/api/system/audit-logs').query({ action: 'account.sign-out' }).expect(200))
        .body,
    ).items;
    expect(logs[0]).toMatchObject({
      target: { type: 'account', name: 'sess-ann（sess-ann）' },
      requestId: signedOut.headers['x-request-id'],
    });
  });
});
