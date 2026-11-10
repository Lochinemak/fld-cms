import { auditLogPageSchema, departmentSchema, type AuditLog } from '@fld/shared';
import type { INestApplication } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { z } from 'zod';
import { AuditRetentionService } from '../src/audit/audit-retention.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { SnowflakeService } from '../src/snowflake/snowflake.service.js';
import { seedTenant } from '../src/tenants/tenant-seed.js';
import { createTestApp } from './app.js';

type TestAgent = ReturnType<typeof request.agent>;

const PASSWORD = 'audit-test-password';
const WRONG_PASSWORD = 'audit-wrong-password';
const NEW_PASSWORD = 'audit-new-password';
const SYSTEM_TENANT = 1n;
const BROWSER = 'audit-test-browser/1.0';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Who sees which records, in order: each test builds on the records the previous ones left. It
// runs on two tenants and accounts of its own (all named audit-*), one of them in both tenants,
// which it removes afterwards with their records.
describe('Audit log (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: RedisService;
  let northId: bigint;
  let southId: bigint;
  let platform: TestAgent;
  let north: TestAgent;
  let south: TestAgent;
  /** Ids of the accounts, by username. */
  const ids: Record<string, string> = {};

  const signIn = async (account: string, password: string) => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/auth/sign-in')
      .set('User-Agent', BROWSER)
      .send({ account, password })
      .expect(200);
    return agent;
  };
  const failSignIn = (account: string, password: string) =>
    request(app.getHttpServer())
      .post('/api/auth/sign-in')
      .set('User-Agent', BROWSER)
      .send({ account, password })
      .expect(401);
  const list = async (agent: TestAgent, query: Record<string, string>): Promise<AuditLog[]> => {
    const res = await agent.get('/api/system/audit-logs').query(query).expect(200);
    return auditLogPageSchema.parse(res.body).items;
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    const snowflake = app.get(SnowflakeService);
    const nextId = () => snowflake.next();
    const passwordHash = await new PasswordHasher().hash(PASSWORD);
    const accounts = [
      { username: 'audit-admin', displayName: '平台审计员' },
      { username: 'audit-north', displayName: '北区管理员' },
      { username: 'audit-south', displayName: '南区管理员' },
      { username: 'audit-shared', displayName: '两地成员' },
    ];
    for (const account of accounts) {
      const user = await prisma.user.create({ data: { id: nextId(), ...account, passwordHash } });
      ids[account.username] = user.id.toString();
    }
    northId = nextId();
    southId = nextId();
    const superAdminRole = await prisma.role.findFirstOrThrow({
      where: { tenantId: SYSTEM_TENANT, builtin: true },
    });
    await prisma.$transaction(async (tx) => {
      const memberId = nextId();
      await tx.tenantMember.create({
        data: { id: memberId, tenantId: SYSTEM_TENANT, userId: BigInt(ids['audit-admin']!) },
      });
      await tx.memberRole.create({
        data: { tenantId: SYSTEM_TENANT, memberId, roleId: superAdminRole.id },
      });
      for (const [id, code, name] of [
        [northId, 'audit-north', 'Audit North'],
        [southId, 'audit-south', 'Audit South'],
      ] as const) {
        await seedTenant(tx, nextId, {
          id,
          code,
          name,
          adminRole: { code: 'tenant_admin', name: '租户管理员' },
          adminUserId: BigInt(ids[code]!),
        });
        await tx.tenantMember.create({
          data: { id: nextId(), tenantId: id, userId: BigInt(ids['audit-shared']!) },
        });
      }
    });
    platform = await signIn('audit-admin', PASSWORD);
    north = await signIn('audit-north', PASSWORD);
    south = await signIn('audit-south', PASSWORD);
  });

  beforeEach(async () => {
    const keys = await redis.keys('fld:throttle:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  afterAll(async () => {
    const users = Object.values(ids).map((id) => BigInt(id));
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { tenantId: { in: [northId, southId] } },
          { accountId: { in: users } },
          { actorUsername: { startsWith: 'audit-' } },
        ],
      },
    });
    await prisma.session.deleteMany({ where: { userId: { in: Object.values(ids) } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [northId, southId] } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await app.close();
  });

  it("records sign-ins, failed ones too, for every tenant of the account's", async () => {
    await failSignIn('audit-shared', WRONG_PASSWORD);
    await signIn('audit-shared', PASSWORD);

    for (const admin of [north, south]) {
      const logs = await list(admin, { actor: 'audit-shared', action: 'auth.sign-in' });
      expect(logs).toMatchObject([
        {
          actor: { id: ids['audit-shared'], username: 'audit-shared', displayName: '两地成员' },
          target: null,
          success: true,
          reason: null,
          userAgent: BROWSER,
        },
        { success: false, reason: '密码错误' },
      ]);
      expect(logs[0]!.ip).toMatch(/^(127\.0\.0\.1|::1)$/);
    }
    // Accounts outside the system tenant are not the platform's business, nor the other way.
    expect(await list(platform, { actor: 'audit-shared' })).toEqual([]);
    expect(await list(platform, { actor: 'audit-admin', action: 'auth.sign-in' })).toHaveLength(1);
    expect(await list(north, { actor: 'audit-admin' })).toEqual([]);
  });

  it('shows sign-ins with unknown accounts to the platform only', async () => {
    await failSignIn('audit-nobody', WRONG_PASSWORD);

    expect(await list(platform, { actor: 'audit-nobody' })).toMatchObject([
      {
        action: 'auth.sign-in',
        actor: { id: null, username: 'audit-nobody', displayName: '' },
        success: false,
        reason: '账号不存在',
      },
    ]);
    expect(await list(north, { actor: 'audit-nobody' })).toEqual([]);
  });

  it("keeps a tenant's administration to the tenant", async () => {
    const depts = z
      .array(departmentSchema)
      .parse((await north.get('/api/system/depts').expect(200)).body);
    const res = await north
      .post('/api/system/depts')
      .send({ name: 'audit-north-sales', parentId: depts[0]!.id })
      .expect(201);
    const dept = departmentSchema.parse(res.body);
    await north.delete(`/api/system/depts/${dept.id}`).expect(204);

    expect(await list(north, { keyword: 'audit-north-sales' })).toMatchObject([
      {
        action: 'dept.delete',
        actor: { username: 'audit-north', displayName: '北区管理员' },
        target: { type: 'dept', id: dept.id, name: 'audit-north-sales' },
      },
      {
        action: 'dept.create',
        changes: [{ field: '上级部门', from: null, to: 'Audit North' }],
      },
    ]);
    expect(await list(south, { keyword: 'audit-north-sales' })).toEqual([]);
    expect(await list(platform, { keyword: 'audit-north-sales' })).toEqual([]);
  });

  it('records password changes without the passwords', async () => {
    const shared = await signIn('audit-shared', PASSWORD);
    await shared
      .put('/api/me/password')
      .send({ currentPassword: WRONG_PASSWORD, newPassword: NEW_PASSWORD })
      .expect(400);
    await shared
      .put('/api/me/password')
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(200);

    expect(
      await list(south, { actor: 'audit-shared', action: 'auth.change-password' }),
    ).toMatchObject([
      { success: true, changes: [] },
      { success: false, reason: '当前密码不正确' },
    ]);
    const rows = JSON.stringify(await prisma.auditLog.findMany(), (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    for (const password of [PASSWORD, WRONG_PASSWORD, NEW_PASSWORD]) {
      expect(rows).not.toContain(password);
    }
  });

  it('opens to those with the permission only', async () => {
    const shared = await signIn('audit-shared', NEW_PASSWORD);
    await shared.get('/api/system/audit-logs').expect(403);
    await request(app.getHttpServer()).get('/api/system/audit-logs').expect(401);
  });

  it('narrows the log to a time range', async () => {
    const now = Date.now();
    const hourAgo = new Date(now - HOUR).toISOString();
    expect(await list(north, { from: hourAgo })).not.toEqual([]);
    expect(await list(north, { to: hourAgo })).toEqual([]);
    expect(await list(north, { from: new Date(now + HOUR).toISOString() })).toEqual([]);
  });

  it('drops the records past the retention period', async () => {
    const snowflake = app.get(SnowflakeService);
    const now = new Date();
    const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);
    const expired = snowflake.next();
    const kept = snowflake.next();
    await prisma.auditLog.createMany({
      data: [
        {
          id: expired,
          tenantId: northId,
          actorUsername: 'audit-old',
          action: 'dept.delete',
          success: true,
          createdAt: daysAgo(366),
        },
        {
          id: kept,
          tenantId: northId,
          actorUsername: 'audit-old',
          action: 'dept.delete',
          success: true,
          createdAt: daysAgo(364),
        },
      ],
    });

    expect(await app.get(AuditRetentionService).removeExpired(now)).toBeGreaterThanOrEqual(1);
    const left = await prisma.auditLog.findMany({
      where: { id: { in: [expired, kept] } },
      select: { id: true },
    });
    expect(left).toEqual([{ id: kept }]);
  });
});
