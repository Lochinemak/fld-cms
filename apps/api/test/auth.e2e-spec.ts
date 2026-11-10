import { createTenantResultSchema, meSchema } from '@fld/shared';
import type { INestApplication } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { resetPassword } from '../src/auth/reset-password.js';
import { generatePassword } from '../src/common/password.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { SystemBootstrapService } from '../src/tenants/system-bootstrap.service.js';
import { createTestApp } from './app.js';

type TestAgent = ReturnType<typeof request.agent>;

// One story, in order: each test builds on the state the previous ones left.
describe('Sign-in, tenants and permissions (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let superAdmin: TestAgent;
  let superAdminPassword: string;
  let acmeId: string;
  let acmeAdminPassword: string;

  const signIn = (agent: TestAgent, account: string, password: string) =>
    agent.post('/api/auth/sign-in').send({ account, password });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    superAdmin = request.agent(app.getHttpServer());
    // The bootstrap only logs the initial password, so give the account one the test knows.
    const reset = await resetPassword(prisma, new PasswordHasher(), 'superadmin');
    superAdminPassword = reset!.password;
  });

  beforeEach(async () => {
    const redis = app.get(RedisService);
    const keys = await redis.keys('fld:throttle:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates the system tenant and its super admin on the first start only', async () => {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: 1n } });
    expect(tenant.code).toBe('system');
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'superadmin' } });
    expect(admin.mustChangePassword).toBe(true);

    await app.get(SystemBootstrapService).onApplicationBootstrap();
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.tenantMember.count()).toBe(1);
  });

  it('refuses guests and wrong credentials', async () => {
    const guest = request(app.getHttpServer());
    await guest.get('/api/me').expect(401);
    await signIn(request.agent(app.getHttpServer()), 'superadmin', 'wrong-password').expect(401);
    await signIn(request.agent(app.getHttpServer()), 'nobody', 'wrong-password').expect(401);
  });

  it('signs in, and allows nothing but account changes until the initial password is replaced', async () => {
    const res = await signIn(superAdmin, ' SuperAdmin ', superAdminPassword).expect(200);
    const me = meSchema.parse(res.body);
    expect(me.user.mustChangePassword).toBe(true);
    expect(me.tenant).toMatchObject({ id: '1', code: 'system', isSystem: true });
    expect(me.permissions).toContain('system:tenant:create');

    await superAdmin.get('/api/system/tenants').expect(403);
  });

  it('changes the password, keeping this sign-in and ending every other one', async () => {
    const otherBrowser = request.agent(app.getHttpServer());
    await signIn(otherBrowser, 'superadmin', superAdminPassword).expect(200);
    const newPassword = generatePassword();

    await superAdmin
      .put('/api/me/password')
      .send({ currentPassword: 'wrong-password', newPassword })
      .expect(400);
    const res = await superAdmin
      .put('/api/me/password')
      .send({ currentPassword: superAdminPassword, newPassword })
      .expect(200);
    superAdminPassword = newPassword;

    expect(meSchema.parse(res.body).user.mustChangePassword).toBe(false);
    await superAdmin.get('/api/system/tenants').expect(200);
    await otherBrowser.get('/api/me').expect(401);
  });

  it('creates a tenant with a new administrator, returning the generated password once', async () => {
    const res = await superAdmin
      .post('/api/system/tenants')
      .send({
        code: 'Acme',
        name: 'Acme 公司',
        admin: {
          mode: 'new',
          username: 'acme.admin',
          displayName: 'Acme 管理员',
          email: 'Admin@Acme.test',
        },
      })
      .expect(201);
    const created = createTenantResultSchema.parse(res.body);
    expect(created.tenant).toMatchObject({ code: 'acme', status: 'ACTIVE', memberCount: 1 });
    expect(created.admin.initialPassword).toEqual(expect.any(String));
    acmeId = created.tenant.id;
    acmeAdminPassword = created.admin.initialPassword!;

    const existingAdmin = { mode: 'existing', account: 'superadmin' };
    await superAdmin
      .post('/api/system/tenants')
      .send({ code: 'acme', name: 'Taken', admin: existingAdmin })
      .expect(409);
    await superAdmin
      .post('/api/system/tenants')
      .send({
        code: 'acme-2',
        name: 'Taken username',
        admin: { mode: 'new', username: 'acme.admin', displayName: 'X' },
      })
      .expect(409);
    await superAdmin
      .post('/api/system/tenants')
      .send({
        code: 'acme-3',
        name: 'No such admin',
        admin: { mode: 'existing', account: 'nobody' },
      })
      .expect(400);
  });

  it("grants a tenant's administrator every permission except the platform ones", async () => {
    const res = await signIn(
      request.agent(app.getHttpServer()),
      'admin@acme.test',
      acmeAdminPassword,
    ).expect(200);
    const me = meSchema.parse(res.body);
    expect(me.tenant?.id).toBe(acmeId);
    expect(me.user.mustChangePassword).toBe(true);
    expect(me.permissions).toContain('system:role:create');
    expect(me.permissions.filter((code) => code.startsWith('system:tenant'))).toEqual([]);
  });

  it('switches tenants per session, refuses stale tabs, and signs in to the last tenant next time', async () => {
    const created = await superAdmin
      .post('/api/system/tenants')
      .send({ code: 'beta', name: 'Beta 公司', admin: { mode: 'existing', account: 'superadmin' } })
      .expect(201);
    const betaId = createTenantResultSchema.parse(created.body).tenant.id;

    await superAdmin.put('/api/me/tenant').send({ tenantId: acmeId }).expect(403);
    const switched = await superAdmin.put('/api/me/tenant').send({ tenantId: betaId }).expect(200);
    const me = meSchema.parse(switched.body);
    expect(me.tenant?.id).toBe(betaId);
    expect(me.tenants.map((tenant) => tenant.code)).toEqual(['system', 'beta']);

    const stale = await superAdmin.get('/api/system/tenants').set('x-tenant-id', '1').expect(409);
    expect(stale.body).toMatchObject({ error: 'tenant_switched' });
    // Tenant management is granted in the system tenant only.
    await superAdmin.get('/api/system/tenants').set('x-tenant-id', betaId).expect(403);

    await superAdmin.post('/api/auth/sign-out').expect(204);
    await superAdmin.get('/api/me').expect(401);
    const again = await signIn(superAdmin, 'superadmin', superAdminPassword).expect(200);
    expect(meSchema.parse(again.body).tenant?.id).toBe(betaId);

    await superAdmin.put('/api/me/tenant').send({ tenantId: '1' }).expect(200);
  });

  it('disables a tenant for its members, but never the system tenant', async () => {
    await superAdmin.patch('/api/system/tenants/1').send({ status: 'DISABLED' }).expect(400);
    await superAdmin.patch('/api/system/tenants/999').send({ name: 'Missing' }).expect(404);
    await superAdmin
      .patch(`/api/system/tenants/${acmeId}`)
      .send({ status: 'DISABLED' })
      .expect(200);

    const res = await signIn(
      request.agent(app.getHttpServer()),
      'acme.admin',
      acmeAdminPassword,
    ).expect(200);
    expect(meSchema.parse(res.body)).toMatchObject({ tenant: null, tenants: [], permissions: [] });

    const list = await superAdmin.get('/api/system/tenants?keyword=ACM').expect(200);
    expect(list.body).toMatchObject({ total: 1, items: [{ code: 'acme', status: 'DISABLED' }] });
  });

  it('limits sign-in attempts per account', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await signIn(request.agent(app.getHttpServer()), 'superadmin', 'wrong-password').expect(401);
    }
    await signIn(request.agent(app.getHttpServer()), 'superadmin', superAdminPassword).expect(429);
  });

  it('resets a password from the command line, signing the account out everywhere', async () => {
    const reset = await resetPassword(prisma, new PasswordHasher(), 'superadmin');
    await superAdmin.get('/api/me').expect(401);

    const res = await signIn(superAdmin, 'superadmin', reset!.password).expect(200);
    expect(meSchema.parse(res.body).user.mustChangePassword).toBe(true);
    expect(await resetPassword(prisma, new PasswordHasher(), 'nobody')).toBeNull();
  });
});
