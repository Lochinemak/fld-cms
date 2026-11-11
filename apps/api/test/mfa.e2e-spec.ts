import {
  memberSchema,
  meSchema,
  pageSchema,
  mfaSetupSchema,
  mfaStatusSchema,
  platformAccountPageSchema,
  recoveryCodesSchema,
} from '@fld/shared';
import type { INestApplication } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { SnowflakeService } from '../src/snowflake/snowflake.service.js';
import { seedTenant } from '../src/tenants/tenant-seed.js';
import { createTestApp } from './app.js';
import { totp } from './totp.js';

type TestAgent = ReturnType<typeof request.agent>;

const PASSWORD = 'mfa-test-password';
const SYSTEM_TENANT = 1n;

// Two-step sign-in, in order: each test builds on the state the previous ones left. It runs on a
// tenant and accounts of its own (all named mfa-*), which it removes afterwards.
describe('Two-step sign-in (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: RedisService;
  let acmeId: bigint;
  let admin: TestAgent;
  let boss: TestAgent;
  let ann: TestAgent;
  let secret = '';
  let recoveryCodes: string[] = [];
  const ids: Record<string, string> = {};

  const browser = () => request.agent(app.getHttpServer());
  const signIn = async (account: string) => {
    const agent = browser();
    const res = await agent
      .post('/api/auth/sign-in')
      .send({ account, password: PASSWORD })
      .expect(200);
    return { agent, body: res.body as unknown };
  };
  const status = async (agent: TestAgent) =>
    mfaStatusSchema.parse((await agent.get('/api/me/mfa').expect(200)).body);
  const clearFailures = async () => {
    const keys = await redis.keys('fld:mfa-failures:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    const snowflake = app.get(SnowflakeService);
    const nextId = () => snowflake.next();
    const passwordHash = await new PasswordHasher().hash(PASSWORD);
    for (const username of ['mfa-admin', 'mfa-boss', 'mfa-ann']) {
      const user = await prisma.user.create({
        data: { id: nextId(), username, displayName: username, passwordHash },
      });
      ids[username] = user.id.toString();
    }
    acmeId = nextId();
    const superAdminRole = await prisma.role.findFirstOrThrow({
      where: { tenantId: SYSTEM_TENANT, builtin: true },
    });
    await prisma.$transaction(async (tx) => {
      const memberId = nextId();
      await tx.tenantMember.create({
        data: { id: memberId, tenantId: SYSTEM_TENANT, userId: BigInt(ids['mfa-admin']!) },
      });
      await tx.memberRole.create({
        data: { tenantId: SYSTEM_TENANT, memberId, roleId: superAdminRole.id },
      });
      await seedTenant(tx, nextId, {
        id: acmeId,
        code: 'mfa-acme',
        name: 'MFA Acme',
        adminRole: { code: 'tenant_admin', name: '租户管理员' },
        adminUserId: BigInt(ids['mfa-boss']!),
      });
      await tx.tenantMember.create({
        data: { id: nextId(), tenantId: acmeId, userId: BigInt(ids['mfa-ann']!) },
      });
    });
    admin = (await signIn('mfa-admin')).agent;
    boss = (await signIn('mfa-boss')).agent;
    ann = (await signIn('mfa-ann')).agent;
  });

  beforeEach(async () => {
    const keys = await redis.keys('fld:throttle:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  afterAll(async () => {
    const users = Object.values(ids);
    await prisma.session.deleteMany({ where: { userId: { in: users } } });
    await prisma.userTotp.deleteMany({ where: { userId: { in: users } } });
    await prisma.mfaRecoveryCode.deleteMany({ where: { userId: { in: users } } });
    await prisma.auditLog.deleteMany({ where: { actorUsername: { startsWith: 'mfa-' } } });
    await prisma.tenant.deleteMany({ where: { id: acmeId } });
    await prisma.user.deleteMany({ where: { id: { in: users.map((id) => BigInt(id)) } } });
    await clearFailures();
    await app.close();
  });

  it('turns on with the password and a code from the app, giving recovery codes once', async () => {
    expect(await status(ann)).toEqual({ available: true, enabled: false, recoveryCodesLeft: 0 });
    await ann.post('/api/me/mfa/setup').send({ currentPassword: 'not-the-password' }).expect(400);
    const setup = mfaSetupSchema.parse(
      (await ann.post('/api/me/mfa/setup').send({ currentPassword: PASSWORD }).expect(200)).body,
    );
    secret = setup.secret;
    expect(setup.uri).toMatch(/^otpauth:\/\/totp\/.+:mfa-ann\?secret=/);
    // Still off until a code proves the app has the secret.
    expect((await status(ann)).enabled).toBe(false);

    const wrong = totp(secret) === '000000' ? '111111' : '000000';
    await ann.post('/api/me/mfa/confirm').send({ code: wrong }).expect(400);
    recoveryCodes = recoveryCodesSchema.parse(
      (
        await ann
          .post('/api/me/mfa/confirm')
          .send({ code: totp(secret, -1) })
          .expect(200)
      ).body,
    ).recoveryCodes;
    expect(recoveryCodes).toHaveLength(10);
    expect(await status(ann)).toEqual({ available: true, enabled: true, recoveryCodesLeft: 10 });
    // The browser that set it up counts as having passed the second step.
    await ann.get('/api/me').expect(200);
    await ann.post('/api/me/mfa/setup').send({ currentPassword: PASSWORD }).expect(400);
  });

  it('asks a new sign-in for the code before anything else', async () => {
    const { agent, body } = await signIn('mfa-ann');
    expect(body).toEqual({ mfaRequired: true });
    const refused = await agent.get('/api/me').expect(401);
    expect(refused.body).toMatchObject({ errorCode: 'mfa_required' });

    await agent.post('/api/auth/mfa').send({ code: '12345' }).expect(400);
    const me = meSchema.parse(
      (
        await agent
          .post('/api/auth/mfa')
          .send({ code: totp(secret) })
          .expect(200)
      ).body,
    );
    expect(me.user.username).toBe('mfa-ann');
    await agent.get('/api/me').expect(200);
    // A browser with no sign-in in progress has nothing to finish.
    await browser()
      .post('/api/auth/mfa')
      .send({ code: totp(secret) })
      .expect(401);
    ann = agent;
  });

  it('takes a recovery code instead, each once', async () => {
    const first = await signIn('mfa-ann');
    await first.agent.post('/api/auth/mfa').send({ recoveryCode: recoveryCodes[0] }).expect(200);
    expect((await status(first.agent)).recoveryCodesLeft).toBe(9);

    const second = await signIn('mfa-ann');
    await second.agent.post('/api/auth/mfa').send({ recoveryCode: recoveryCodes[0] }).expect(400);
    await clearFailures();
  });

  it('refuses every code after five wrong ones, and records the attempts', async () => {
    const { agent } = await signIn('mfa-ann');
    const wrong = totp(secret) === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 5; attempt++) {
      await agent.post('/api/auth/mfa').send({ code: wrong }).expect(400);
    }
    const locked = await agent
      .post('/api/auth/mfa')
      .send({ code: totp(secret, 1) })
      .expect(400);
    expect(locked.body).toMatchObject({ message: '输错太多次，请 15 分钟后再试' });
    expect(
      await prisma.auditLog.count({
        where: { action: 'auth.sign-in', success: false, accountId: BigInt(ids['mfa-ann']!) },
      }),
    ).toBeGreaterThanOrEqual(6);
    await clearFailures();
  });

  it('shows administrators who has it, and lets them turn it off', async () => {
    const members = pageSchema(memberSchema).parse(
      (await boss.get('/api/system/members').query({ keyword: 'mfa-ann' }).expect(200)).body,
    ).items;
    expect(members[0]).toMatchObject({ username: 'mfa-ann', mfaEnabled: true });

    await boss.post(`/api/system/members/${members[0]!.id}/reset-mfa`).expect(200);
    expect((await status(ann)).enabled).toBe(false);
    await boss.post(`/api/system/members/${members[0]!.id}/reset-mfa`).expect(400);
    // The password alone signs in again.
    expect((await signIn('mfa-ann')).body).toMatchObject({ user: { username: 'mfa-ann' } });
  });

  it('turns off with the password, from a browser that passed the second step', async () => {
    const setup = mfaSetupSchema.parse(
      (await ann.post('/api/me/mfa/setup').send({ currentPassword: PASSWORD }).expect(200)).body,
    );
    secret = setup.secret;
    await ann
      .post('/api/me/mfa/confirm')
      .send({ code: totp(secret) })
      .expect(200);

    const renewed = recoveryCodesSchema.parse(
      (await ann.post('/api/me/mfa/recovery-codes').expect(200)).body,
    );
    expect(renewed.recoveryCodes).toHaveLength(10);
    await ann.post('/api/me/mfa/disable').send({ currentPassword: 'wrong' }).expect(400);
    await ann.post('/api/me/mfa/disable').send({ currentPassword: PASSWORD }).expect(204);
    expect((await status(ann)).enabled).toBe(false);
  });

  it('lets the platform reset it too', async () => {
    const setup = mfaSetupSchema.parse(
      (await ann.post('/api/me/mfa/setup').send({ currentPassword: PASSWORD }).expect(200)).body,
    );
    await ann
      .post('/api/me/mfa/confirm')
      .send({ code: totp(setup.secret, 1) })
      .expect(200);
    const accounts = platformAccountPageSchema.parse(
      (await admin.get('/api/system/accounts').query({ keyword: 'mfa-ann' }).expect(200)).body,
    ).items;
    expect(accounts[0]).toMatchObject({ mfaEnabled: true });
    await admin.post(`/api/system/accounts/${ids['mfa-ann']}/reset-mfa`).expect(200);
    expect((await status(ann)).enabled).toBe(false);
  });
});
