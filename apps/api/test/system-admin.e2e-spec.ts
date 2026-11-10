import {
  createMemberResultSchema,
  departmentSchema,
  memberSchema,
  meSchema,
  pageSchema,
  resetMemberPasswordResultSchema,
  roleSchema,
} from '@fld/shared';
import type { INestApplication } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { z } from 'zod';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { SnowflakeService } from '../src/snowflake/snowflake.service.js';
import { seedTenant } from '../src/tenants/tenant-seed.js';
import { createTestApp } from './app.js';

type TestAgent = ReturnType<typeof request.agent>;

const PASSWORD = 'org-test-password';
const memberPageSchema = pageSchema(memberSchema);
const SALES_MANAGER_PERMISSIONS = [
  'system:member',
  'system:member:create',
  'system:member:update',
  'system:dept',
];

// One story, in order: each test builds on the state the previous ones left. It runs in two
// tenants of its own, which it removes afterwards with their accounts (all named org-*).
describe('Departments, roles and members (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let acmeId: bigint;
  let otherId: bigint;
  let otherRootDept: string;
  let admin: TestAgent;
  let manager: TestAgent;
  let managerPassword: string;
  /** Ids of the departments, roles and members the story creates, by name. */
  const ids: Record<string, string> = {};

  const signIn = async (account: string, password: string) => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/sign-in').send({ account, password }).expect(200);
    return agent;
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const snowflake = app.get(SnowflakeService);
    const nextId = () => snowflake.next();
    const passwordHash = await new PasswordHasher().hash(PASSWORD);
    const [adminUser, helperUser] = await Promise.all(
      ['org-admin', 'org-helper'].map((username) =>
        prisma.user.create({
          data: { id: nextId(), username, displayName: username, passwordHash },
        }),
      ),
    );
    acmeId = nextId();
    otherId = nextId();
    await prisma.$transaction(async (tx) => {
      const adminRole = { code: 'tenant_admin', name: '租户管理员' };
      await seedTenant(tx, nextId, {
        id: acmeId,
        code: 'org-acme',
        name: 'Acme',
        adminRole,
        adminUserId: adminUser!.id,
      });
      await seedTenant(tx, nextId, {
        id: otherId,
        code: 'org-other',
        name: 'Other',
        adminRole,
        adminUserId: helperUser!.id,
      });
    });
    const otherRoot = await prisma.department.findFirstOrThrow({ where: { tenantId: otherId } });
    otherRootDept = otherRoot.id.toString();
    admin = await signIn('org-admin', PASSWORD);
  });

  beforeEach(async () => {
    const redis = app.get(RedisService);
    const keys = await redis.keys('fld:throttle:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { username: { startsWith: 'org-' } },
      select: { id: true },
    });
    await prisma.session.deleteMany({
      where: { userId: { in: users.map(({ id }) => id.toString()) } },
    });
    await prisma.tenant.deleteMany({ where: { id: { in: [acmeId, otherId] } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(({ id }) => id) } } });
    await app.close();
  });

  it('starts a tenant with its root department and built-in administrator role', async () => {
    const depts = z
      .array(departmentSchema)
      .parse((await admin.get('/api/system/depts').expect(200)).body);
    expect(depts).toEqual([
      expect.objectContaining({ parentId: null, name: 'Acme', memberCount: 1 }),
    ]);
    ids['root'] = depts[0]!.id;

    // Only this tenant's roles: the other tenant's administrator role stays out.
    const roles = z
      .array(roleSchema)
      .parse((await admin.get('/api/system/roles').expect(200)).body);
    expect(roles).toHaveLength(1);
    expect(roles[0]).toMatchObject({ builtin: true, dataScope: 'ALL', memberCount: 1 });
    expect(roles[0]!.permissions).toContain('system:member:reset-password');
    expect(roles[0]!.permissions).not.toContain('system:tenant');
    ids['adminRole'] = roles[0]!.id;
  });

  it('builds the department tree and moves whole branches', async () => {
    for (const [name, parent] of [
      ['sales', 'root'],
      ['east', 'sales'],
      ['support', 'root'],
      ['team', 'support'],
    ] as const) {
      const res = await admin
        .post('/api/system/depts')
        .send({ name, parentId: ids[parent] })
        .expect(201);
      ids[name] = departmentSchema.parse(res.body).id;
    }

    await admin
      .patch(`/api/system/depts/${ids['team']}`)
      .send({ parentId: ids['east'] })
      .expect(200);
    const team = await prisma.department.findUniqueOrThrow({ where: { id: BigInt(ids['team']!) } });
    expect(team.path).toBe(`/${ids['root']}/${ids['sales']}/${ids['east']}/${ids['team']}/`);

    // Not under its own branch, not the root, and not with departments below it.
    await admin
      .patch(`/api/system/depts/${ids['sales']}`)
      .send({ parentId: ids['team'] })
      .expect(400);
    await admin
      .patch(`/api/system/depts/${ids['root']}`)
      .send({ parentId: ids['sales'] })
      .expect(400);
    await admin.delete(`/api/system/depts/${ids['root']}`).expect(400);
    await admin.delete(`/api/system/depts/${ids['sales']}`).expect(409);
    // Another tenant's department is no parent here.
    await admin.post('/api/system/depts').send({ name: 'x', parentId: otherRootDept }).expect(400);
  });

  it('creates roles from the permissions the tenant may grant', async () => {
    const res = await admin
      .post('/api/system/roles')
      .send({
        code: 'Sales_Manager',
        name: '销售经理',
        dataScope: 'DEPT_AND_CHILDREN',
        permissions: SALES_MANAGER_PERMISSIONS,
      })
      .expect(201);
    const role = roleSchema.parse(res.body);
    expect(role).toMatchObject({ code: 'sales_manager', builtin: false, deptIds: [] });
    ids['salesManager'] = role.id;

    const auditor = await admin
      .post('/api/system/roles')
      .send({
        code: 'auditor',
        name: '审计',
        dataScope: 'CUSTOM',
        deptIds: [ids['support']],
        permissions: ['system:role'],
      })
      .expect(201);
    expect(roleSchema.parse(auditor.body).deptIds).toEqual([ids['support']]);
    ids['auditor'] = roleSchema.parse(auditor.body).id;

    const create = (body: object) => admin.post('/api/system/roles').send(body);
    await create({ code: 'sales_manager', name: '重复', dataScope: 'SELF' }).expect(409);
    // Platform permissions belong to the system tenant only.
    await create({
      code: 'platform',
      name: '平台',
      dataScope: 'SELF',
      permissions: ['system:tenant'],
    }).expect(400);
    await create({ code: 'custom', name: '自定义', dataScope: 'CUSTOM' }).expect(400);
    await admin
      .put(`/api/system/roles/${ids['adminRole']}`)
      .send({ name: 'x', dataScope: 'ALL' })
      .expect(400);
    await admin.delete(`/api/system/roles/${ids['adminRole']}`).expect(400);
  });

  it('adds members with new or existing accounts', async () => {
    const created = createMemberResultSchema.parse(
      (
        await admin
          .post('/api/system/members')
          .send({
            account: { mode: 'new', username: 'org-manager', displayName: '经理' },
            deptId: ids['sales'],
            roleIds: [ids['salesManager']],
          })
          .expect(201)
      ).body,
    );
    expect(created.member).toMatchObject({
      username: 'org-manager',
      dept: { id: ids['sales'], name: 'sales' },
      roles: [{ id: ids['salesManager'], builtin: false }],
      sharedAccount: false,
    });
    managerPassword = created.initialPassword!;
    expect(managerPassword).toHaveLength(16);

    // A password given is not returned.
    const rep = await admin
      .post('/api/system/members')
      .send({
        account: { mode: 'new', username: 'org-rep', displayName: '代表', password: PASSWORD },
        deptId: ids['team'],
      })
      .expect(201);
    expect(createMemberResultSchema.parse(rep.body).initialPassword).toBeUndefined();

    const helper = await admin
      .post('/api/system/members')
      .send({ account: { mode: 'existing', account: ' ORG-Helper ' }, deptId: ids['support'] })
      .expect(201);
    expect(createMemberResultSchema.parse(helper.body).member.sharedAccount).toBe(true);

    const add = (body: object) => admin.post('/api/system/members').send(body);
    await add({
      account: { mode: 'existing', account: 'org-helper' },
      deptId: ids['support'],
    }).expect(409);
    await add({
      account: { mode: 'existing', account: 'org-nobody' },
      deptId: ids['support'],
    }).expect(400);
    await add({
      account: { mode: 'new', username: 'org-rep', displayName: '重名' },
      deptId: ids['support'],
    }).expect(409);
    await add({
      account: { mode: 'new', username: 'org-stray', displayName: '跨租户' },
      deptId: otherRootDept,
    }).expect(400);

    const page = memberPageSchema.parse((await admin.get('/api/system/members').expect(200)).body);
    expect(page.total).toBe(4);
    for (const member of page.items) {
      ids[member.username] = member.id;
    }
  });

  it("limits a manager to their department's branch", async () => {
    manager = await signIn('org-manager', managerPassword);
    // The generated password has to go before anything else.
    await manager.get('/api/system/members').expect(403);
    await manager
      .put('/api/me/password')
      .send({ currentPassword: managerPassword, newPassword: PASSWORD })
      .expect(200);

    const page = memberPageSchema.parse(
      (await manager.get('/api/system/members').expect(200)).body,
    );
    expect(page.items.map(({ username }) => username)).toEqual(['org-manager', 'org-rep']);
    const team = memberPageSchema.parse(
      (await manager.get('/api/system/members').query({ deptId: ids['team'] }).expect(200)).body,
    );
    expect(team.items.map(({ username }) => username)).toEqual(['org-rep']);

    const update = (member: string, body: object) =>
      manager.patch(`/api/system/members/${ids[member]}`).send(body);
    // Outside the branch, the manager themselves, and moving someone out of the branch.
    await update('org-helper', { status: 'DISABLED' }).expect(404);
    await update('org-admin', { status: 'DISABLED' }).expect(404);
    await update('org-manager', { status: 'DISABLED' }).expect(400);
    await update('org-rep', { deptId: ids['support'] }).expect(403);
    await update('org-rep', { deptId: ids['east'] }).expect(200);
  });

  it('never lets anyone hand out more than they hold', async () => {
    const assign = (roleIds: (string | undefined)[]) =>
      manager.patch(`/api/system/members/${ids['org-rep']}`).send({ roleIds });
    await assign([ids['adminRole']]).expect(403);
    await assign([ids['auditor']]).expect(403);
    const res = await assign([ids['salesManager']]).expect(200);
    expect(memberSchema.parse(res.body).roles.map(({ id }) => id)).toEqual([ids['salesManager']]);

    // Given role management, the manager still can't create roles beyond their own grant.
    await admin
      .put(`/api/system/roles/${ids['salesManager']}`)
      .send({
        name: '销售经理',
        dataScope: 'DEPT_AND_CHILDREN',
        permissions: [...SALES_MANAGER_PERMISSIONS, 'system:role', 'system:role:create'],
      })
      .expect(200);
    let n = 0;
    const create = (body: object) =>
      manager.post('/api/system/roles').send({ code: `org-role-${++n}`, name: '角色', ...body });
    await create({ dataScope: 'SELF', permissions: ['system:member:reset-password'] }).expect(403);
    await create({ dataScope: 'ALL' }).expect(403);
    await create({ dataScope: 'CUSTOM', deptIds: [ids['support']] }).expect(403);
    await create({
      dataScope: 'CUSTOM',
      deptIds: [ids['east']],
      permissions: ['system:member'],
    }).expect(201);
  });

  it('lets only administrators change administrators', async () => {
    // Seeing every member now, the manager reaches the administrator but may not change them.
    await admin
      .put(`/api/system/roles/${ids['salesManager']}`)
      .send({ name: '销售经理', dataScope: 'ALL', permissions: SALES_MANAGER_PERMISSIONS })
      .expect(200);
    const page = memberPageSchema.parse(
      (await manager.get('/api/system/members').expect(200)).body,
    );
    expect(page.total).toBe(4);
    await manager
      .patch(`/api/system/members/${ids['org-admin']}`)
      .send({ status: 'DISABLED' })
      .expect(403);
  });

  it('resets passwords only of accounts that belong to this tenant alone', async () => {
    const res = await admin
      .post(`/api/system/members/${ids['org-rep']}/reset-password`)
      .expect(200);
    const { password } = resetMemberPasswordResultSchema.parse(res.body);
    const rep = await signIn('org-rep', password);
    const me = meSchema.parse((await rep.get('/api/me').expect(200)).body);
    expect(me.user.mustChangePassword).toBe(true);

    await admin.post(`/api/system/members/${ids['org-helper']}/reset-password`).expect(403);
    // Without the permission.
    await manager.post(`/api/system/members/${ids['org-rep']}/reset-password`).expect(403);
  });

  it('applies changes to roles and memberships on the next request', async () => {
    await admin
      .put(`/api/system/roles/${ids['salesManager']}`)
      .send({ name: '销售经理', dataScope: 'ALL', permissions: ['system:dept'] })
      .expect(200);
    await manager.get('/api/system/members').expect(403);
    await manager.get('/api/system/depts').expect(200);

    await admin.delete(`/api/system/members/${ids['org-manager']}`).expect(204);
    const me = meSchema.parse((await manager.get('/api/me').expect(200)).body);
    expect(me.tenant).toBeNull();
    await manager.get('/api/system/depts').expect(403);

    await admin.delete(`/api/system/roles/${ids['salesManager']}`).expect(204);
    const roles = z
      .array(roleSchema)
      .parse((await admin.get('/api/system/roles').expect(200)).body);
    expect(roles.map(({ code }) => code)).not.toContain('sales_manager');
  });
});
