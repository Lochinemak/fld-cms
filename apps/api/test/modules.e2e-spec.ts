import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  attachmentSchema,
  auditLogPageSchema,
  createTenantResultSchema,
  customerSchema,
  fileShareSchema,
  meSchema,
  pageSchema,
  roleSchema,
  storedFileDetailSchema,
  storedFileSchema,
  tenantPageSchema,
  tenantSchema,
  type AuditAction,
  type PermissionCode,
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

const PASSWORD = 'modules-test-password';
const SYSTEM_TENANT = 1n;
const USERNAMES = ['mod-platform', 'mod-admin', 'mod-manager', 'mod-lead', 'mod-rep'];

const ASSIGNING: PermissionCode[] = ['system:member', 'system:member:update'];
const CUSTOMER_PERMISSIONS: PermissionCode[] = [
  'crm:customer',
  'crm:customer:create',
  'crm:customer:update',
];
const FILE_PERMISSIONS: PermissionCode[] = [
  'file:library',
  'file:library:upload',
  'file:library:delete',
  'file:library:share',
];

const sorted = (codes: readonly string[]) => [...codes].sort();

// The story of a tenant that goes without a module and gets it back. The platform switches the
// modules of Acme; its administrator has everything there is, the manager and the lead assign
// roles (only the lead's role has customers in it), and the rep works with customers and files.
// Acme, a second tenant and their accounts (all named mod-*) are removed afterwards, stored
// contents included.
describe('Modules (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let acmeId: bigint;
  const userIds: Record<string, bigint> = {};
  const agents: Record<string, TestAgent> = {};
  /** Ids of the records the story creates, by name. */
  const ids: Record<string, string> = {};
  const storageDir = process.env['STORAGE_LOCAL_DIR']!;

  const agent = (username: string) => agents[username]!;
  const id = (name: string) => ids[name]!;
  const anonymous = () => request(app.getHttpServer());
  const signIn = async (account: string, password: string) => {
    const signedIn = request.agent(app.getHttpServer());
    const res = await signedIn.post('/api/auth/sign-in').send({ account, password }).expect(200);
    return { agent: signedIn, me: meSchema.parse(res.body) };
  };
  const me = async (as: TestAgent) => meSchema.parse((await as.get('/api/me').expect(200)).body);
  const roles = async (as: TestAgent) =>
    z.array(roleSchema).parse((await as.get('/api/system/roles').expect(200)).body);
  /** Sets the modules Acme goes without, as the platform does on the tenant. */
  const switchOff = (disabledModules: string[]) =>
    agent('mod-platform').patch(`/api/system/tenants/${acmeId}`).send({ disabledModules });
  const listedAcme = async () =>
    tenantPageSchema.parse(
      (
        await agent('mod-platform')
          .get('/api/system/tenants')
          .query({ keyword: 'mod-acme' })
          .expect(200)
      ).body,
    ).items;
  const planFile = async (as: TestAgent) =>
    storedFileDetailSchema.parse((await as.get(`/api/files/${id('plan.pdf')}`).expect(200)).body);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const snowflake = app.get(SnowflakeService);
    const nextId = () => snowflake.next();
    const passwordHash = await new PasswordHasher().hash(PASSWORD);
    for (const username of USERNAMES) {
      const user = await prisma.user.create({
        data: { id: nextId(), username, displayName: username, passwordHash },
      });
      userIds[username] = user.id;
    }
    acmeId = nextId();
    const superAdminRole = await prisma.role.findFirstOrThrow({
      where: { tenantId: SYSTEM_TENANT, builtin: true },
    });
    await prisma.$transaction(async (tx) => {
      const platformMemberId = nextId();
      await tx.tenantMember.create({
        data: { id: platformMemberId, tenantId: SYSTEM_TENANT, userId: userIds['mod-platform']! },
      });
      await tx.memberRole.create({
        data: { tenantId: SYSTEM_TENANT, memberId: platformMemberId, roleId: superAdminRole.id },
      });
      await seedTenant(tx, nextId, {
        id: acmeId,
        code: 'mod-acme',
        name: 'Mod Acme',
        adminRole: { code: 'tenant_admin', name: '租户管理员' },
        adminUserId: userIds['mod-admin']!,
      });
      const root = await tx.department.findFirstOrThrow({ where: { tenantId: acmeId } });
      const addRole = async (
        code: string,
        dataScope: 'ALL' | 'SELF',
        permissions: PermissionCode[],
      ) => {
        const roleId = nextId();
        await tx.role.create({
          data: { id: roleId, tenantId: acmeId, code, name: code, dataScope },
        });
        await tx.rolePermission.createMany({
          data: permissions.map((permission) => ({ roleId, permission })),
        });
        ids[code] = roleId.toString();
        return roleId;
      };
      const managerRole = await addRole('mod-manager', 'ALL', ASSIGNING);
      const leadRole = await addRole('mod-lead', 'ALL', [...ASSIGNING, ...CUSTOMER_PERMISSIONS]);
      const salesRole = await addRole('mod-sales', 'SELF', [
        ...CUSTOMER_PERMISSIONS,
        ...FILE_PERMISSIONS,
        'file:library:folder',
      ]);
      await addRole('mod-crm', 'SELF', ['crm:customer']);
      const members: [string, bigint][] = [
        ['mod-manager', managerRole],
        ['mod-lead', leadRole],
        ['mod-rep', salesRole],
      ];
      for (const [username, roleId] of members) {
        const memberId = nextId();
        await tx.tenantMember.create({
          data: { id: memberId, tenantId: acmeId, userId: userIds[username]!, deptId: root.id },
        });
        await tx.memberRole.create({ data: { tenantId: acmeId, memberId, roleId } });
        ids[username] = memberId.toString();
      }
    });
    for (const username of USERNAMES) {
      agents[username] = (await signIn(username, PASSWORD)).agent;
    }
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
      where: { username: { startsWith: 'mod-' } },
      select: { id: true },
    });
    const tenants = await prisma.tenant.findMany({
      where: { code: { startsWith: 'mod-' } },
      select: { id: true },
    });
    const userKeys = users.map((user) => user.id);
    const tenantIds = tenants.map((tenant) => tenant.id);
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { tenantId: { in: tenantIds } },
          { accountId: { in: userKeys } },
          { actorUsername: { startsWith: 'mod-' } },
        ],
      },
    });
    await prisma.session.deleteMany({
      where: { userId: { in: userKeys.map((key) => key.toString()) } },
    });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userKeys } } });
    for (const tenantId of tenantIds) {
      await rm(join(storageDir, 'files', tenantId.toString()), { recursive: true, force: true });
    }
    await app.close();
  });

  it('has every module on until the platform switches one off', async () => {
    expect(await listedAcme()).toEqual([
      expect.objectContaining({ code: 'mod-acme', disabledModules: [] }),
    ]);
    const admin = await me(agent('mod-admin'));
    expect(admin.tenant).toMatchObject({ code: 'mod-acme', disabledModules: [] });
    expect(admin.tenants).toEqual([
      expect.objectContaining({ code: 'mod-acme', disabledModules: [] }),
    ]);
    expect(admin.permissions).toEqual(
      expect.arrayContaining(['crm:customer', 'file:library', 'system:role']),
    );

    // What the rep leaves for the rest of the story: a customer with a file, shared by a link.
    const rep = agent('mod-rep');
    const customer = customerSchema.parse(
      (await rep.post('/api/crm/customers').send({ name: 'Mod Co' }).expect(201)).body,
    );
    ids['Mod Co'] = customer.id;
    const file = storedFileSchema.parse(
      (
        await rep
          .post('/api/files')
          .attach('file', Buffer.from('%PDF-plan'), 'plan.pdf')
          .expect(201)
      ).body,
    );
    ids['plan.pdf'] = file.id;
    await rep
      .post(`/api/crm/customers/${customer.id}/attachments`)
      .send({ fileIds: [file.id] })
      .expect(201);
    const share = fileShareSchema.parse(
      (await rep.post(`/api/files/${file.id}/shares`).send({}).expect(201)).body,
    );
    ids['share'] = share.token;
    await anonymous().get(`/api/public/shares/${share.token}`).expect(200);
  });

  it('takes a module switched off from everyone in the tenant, its administrator included', async () => {
    const switched = tenantSchema.parse((await switchOff(['crm']).expect(200)).body);
    expect(switched.disabledModules).toEqual(['crm']);
    expect(await listedAcme()).toEqual([
      expect.objectContaining({ code: 'mod-acme', disabledModules: ['crm'] }),
    ]);

    // At once: nobody signs in again.
    const admin = await me(agent('mod-admin'));
    expect(admin.tenant?.disabledModules).toEqual(['crm']);
    expect(admin.permissions.filter((code) => code.startsWith('crm'))).toEqual([]);
    expect(admin.permissions).toEqual(expect.arrayContaining(['file:library', 'system:role']));
    for (const username of ['mod-admin', 'mod-rep']) {
      await agent(username).get('/api/crm/customers').expect(403);
      await agent(username)
        .get(`/api/crm/customers/${id('Mod Co')}`)
        .expect(403);
      await agent(username)
        .get(`/api/crm/customers/${id('Mod Co')}/attachments`)
        .expect(403);
      await agent(username).post('/api/crm/customers').send({ name: 'Late Co' }).expect(403);
    }

    // Roles keep what they hold of the module without showing it, and take no more of it.
    const listed = await roles(agent('mod-admin'));
    expect(
      listed.flatMap((role) => role.permissions).filter((code) => code.startsWith('crm')),
    ).toEqual([]);
    expect(sorted(listed.find((role) => role.code === 'mod-sales')!.permissions)).toEqual(
      sorted([...FILE_PERMISSIONS, 'file:library:folder']),
    );
    const refused = await agent('mod-admin')
      .post('/api/system/roles')
      .send({
        code: 'mod-late',
        name: '后来的角色',
        dataScope: 'SELF',
        permissions: ['crm:customer'],
      })
      .expect(400);
    expect(refused.body.message).toBe('包含本租户不能授予的权限');
    await agent('mod-admin')
      .put(`/api/system/roles/${id('mod-sales')}`)
      .send({ name: 'mod-sales', dataScope: 'SELF', permissions: FILE_PERMISSIONS })
      .expect(200);
    const kept = await prisma.rolePermission.findMany({
      where: { roleId: BigInt(id('mod-sales')) },
      select: { permission: true },
    });
    expect(sorted(kept.map((row) => row.permission))).toEqual(
      sorted([...CUSTOMER_PERMISSIONS, ...FILE_PERMISSIONS]),
    );

    // The file stays in use by a customer nobody sees now.
    expect(await planFile(agent('mod-rep'))).toMatchObject({ usages: [], hiddenUsages: 1 });
    const inUse = await agent('mod-rep')
      .delete(`/api/files/${id('plan.pdf')}`)
      .expect(409);
    expect(inUse.body.message).toBe('该文件正在被使用，不能删除。用在：1 处你看不到的记录');
  });

  it('lets nobody hand out, with a role, what they do not keep of a module switched off', async () => {
    const assign = (as: string, roleIds: string[]) =>
      agent(as)
        .patch(`/api/system/members/${id('mod-rep')}`)
        .send({ roleIds });
    const withCustomers = [id('mod-sales'), id('mod-crm')];

    // Once the module is back, the role gives its customers: more than the manager has.
    const refused = await assign('mod-manager', withCustomers).expect(403);
    expect(refused.body.message).toBe('不能授予自己没有的权限');
    await assign('mod-lead', withCustomers).expect(200);
    await assign('mod-admin', [id('mod-sales')]).expect(200);
    await assign('mod-admin', withCustomers).expect(200);
    await assign('mod-admin', [id('mod-sales')]).expect(200);
  });

  it('gives everything back with the module', async () => {
    const switched = tenantSchema.parse((await switchOff([]).expect(200)).body);
    expect(switched.disabledModules).toEqual([]);

    const admin = await me(agent('mod-admin'));
    expect(admin.tenant?.disabledModules).toEqual([]);
    expect(admin.permissions).toContain('crm:customer');
    const rep = agent('mod-rep');
    const customers = pageSchema(customerSchema).parse(
      (await rep.get('/api/crm/customers').expect(200)).body,
    );
    expect(customers.items.map((customer) => customer.name)).toEqual(['Mod Co']);
    // The role has its customers again, and the edit made meanwhile.
    const sales = (await roles(agent('mod-admin'))).find((role) => role.code === 'mod-sales')!;
    expect(sorted(sales.permissions)).toEqual(
      sorted([...CUSTOMER_PERMISSIONS, ...FILE_PERMISSIONS]),
    );
    expect(await planFile(rep)).toMatchObject({
      usages: [{ type: 'CUSTOMER', id: id('Mod Co'), name: 'Mod Co' }],
      hiddenUsages: 0,
    });
  });

  it('closes the library and its share links with the files module, leaving attachments readable', async () => {
    await switchOff(['file']).expect(200);
    const rep = agent('mod-rep');
    const open = (path = '') => anonymous().get(`/api/public/shares/${id('share')}${path}`);

    for (const path of ['', '/content']) {
      expect((await open(path).expect(404)).body.message).toBe('链接不存在或已失效');
    }
    expect((await me(rep)).permissions.filter((code) => code.startsWith('file'))).toEqual([]);
    await rep.get('/api/files').expect(403);
    await rep.get('/api/files/recent').expect(403);
    await rep.get(`/api/files/${id('plan.pdf')}`).expect(403);
    await agent('mod-admin').post('/api/files/folders').send({ name: '晚了' }).expect(403);

    // What customers have attached stays readable; they take no more.
    const url = `/api/crm/customers/${id('Mod Co')}/attachments`;
    const attached = z.array(attachmentSchema).parse((await rep.get(url).expect(200)).body);
    expect(attached.map((attachment) => attachment.file.name)).toEqual(['plan.pdf']);
    const content = await rep
      .get(`${url}/${id('plan.pdf')}/content`)
      .responseType('blob')
      .expect(200);
    expect((content.body as Buffer).toString()).toBe('%PDF-plan');
    const refused = await rep
      .post(url)
      .send({ fileIds: [id('plan.pdf')] })
      .expect(403);
    expect(refused.body.message).toBe('文件管理已关闭，不能添加附件');

    // Named in any order and more than once, the modules come out as the registry lists them.
    const both = tenantSchema.parse((await switchOff(['file', 'crm', 'file']).expect(200)).body);
    expect(both.disabledModules).toEqual(['crm', 'file']);
    expect(
      (await me(agent('mod-admin'))).permissions.filter((code) => /^(crm|file)/.test(code)),
    ).toEqual([]);

    await switchOff([]).expect(200);
    await open().expect(200);
    await rep.get('/api/files').expect(200);
  });

  it('leaves the switch to the platform, the system tenant whole, and new tenants a choice', async () => {
    const platform = agent('mod-platform');
    await agent('mod-admin')
      .patch(`/api/system/tenants/${acmeId}`)
      .send({ disabledModules: ['crm'] })
      .expect(403);
    const system = await platform
      .patch(`/api/system/tenants/${SYSTEM_TENANT}`)
      .send({ disabledModules: ['crm'] })
      .expect(400);
    expect(system.body.message).toBe('系统租户没有可以关闭的模块');
    // Only a module can be switched off: not the system pages, a page or what does not exist.
    for (const unknown of ['system', 'crm:customer', 'nope']) {
      await switchOff([unknown]).expect(400);
    }
    expect((await me(agent('mod-admin'))).tenant?.disabledModules).toEqual([]);

    const created = await platform
      .post('/api/system/tenants')
      .send({
        code: 'mod-beta',
        name: 'Mod Beta',
        admin: { mode: 'new', username: 'mod-beta-admin', displayName: 'Beta 管理员' },
        disabledModules: ['file'],
      })
      .expect(201);
    const { tenant: beta, admin } = createTenantResultSchema.parse(created.body);
    expect(beta.disabledModules).toEqual(['file']);
    const betaAdmin = (await signIn('mod-beta-admin', admin.initialPassword!)).me;
    expect(betaAdmin.tenant).toMatchObject({ code: 'mod-beta', disabledModules: ['file'] });
    expect(betaAdmin.permissions).toContain('crm:customer');
    expect(betaAdmin.permissions.filter((code) => code.startsWith('file'))).toEqual([]);
  });

  it('records which modules were switched', async () => {
    const switches = async (action: AuditAction, keyword: string) =>
      auditLogPageSchema
        .parse(
          (
            await agent('mod-platform')
              .get('/api/system/audit-logs')
              .query({ action, keyword })
              .expect(200)
          ).body,
        )
        .items.map((log) => log.changes.filter((change) => change.field.endsWith('的模块')));

    // The latest first.
    expect(await switches('tenant.update', 'Mod Acme')).toEqual([
      [{ field: '开启的模块', from: null, to: '客户关系、文件管理' }],
      [{ field: '关闭的模块', from: null, to: '客户关系' }],
      [{ field: '关闭的模块', from: null, to: '文件管理' }],
      [{ field: '开启的模块', from: null, to: '客户关系' }],
      [{ field: '关闭的模块', from: null, to: '客户关系' }],
    ]);
    expect(await switches('tenant.create', 'Mod Beta')).toEqual([
      [{ field: '关闭的模块', from: null, to: '文件管理' }],
    ]);
  });
});
