import {
  contactSchema,
  customerSchema,
  customFieldSchema,
  dictionaryItemSchema,
  dictionarySchema,
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

const PASSWORD = 'cf-test-password';
const SALES_PERMISSIONS: PermissionCode[] = [
  'crm:customer',
  'crm:customer:create',
  'crm:customer:update',
  'crm:contact',
  'crm:contact:create',
];

// Data dictionaries and custom fields, in order: each test builds on the state the previous ones
// left. It runs on tenants and accounts of its own (all named cf-*), which it removes afterwards.
describe('Dictionaries and custom fields (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let acmeId: bigint;
  let otherId: bigint;
  let admin: TestAgent;
  let sales: TestAgent;
  let other: TestAgent;
  const ids: Record<string, string> = {};
  let regions: z.infer<typeof dictionarySchema>;
  let customerId = '';

  const dictionaries = async (agent: TestAgent) =>
    z.array(dictionarySchema).parse((await agent.get('/api/dictionaries').expect(200)).body);
  const fields = async (agent: TestAgent, entity: string) =>
    z
      .array(customFieldSchema)
      .parse((await agent.get('/api/custom-fields').query({ entity }).expect(200)).body);
  const addField = (agent: TestAgent, field: object) =>
    agent.post('/api/custom-fields').send({ entity: 'crm.customer', ...field });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const snowflake = app.get(SnowflakeService);
    const nextId = () => snowflake.next();
    const passwordHash = await new PasswordHasher().hash(PASSWORD);
    for (const username of ['cf-admin', 'cf-sales', 'cf-other']) {
      const user = await prisma.user.create({
        data: { id: nextId(), username, displayName: username, passwordHash },
      });
      ids[username] = user.id.toString();
    }
    acmeId = nextId();
    otherId = nextId();
    const adminRole = { code: 'tenant_admin', name: '租户管理员' };
    await prisma.$transaction(async (tx) => {
      await seedTenant(tx, nextId, {
        id: acmeId,
        code: 'cf-acme',
        name: 'CF Acme',
        adminRole,
        adminUserId: BigInt(ids['cf-admin']!),
      });
      await seedTenant(tx, nextId, {
        id: otherId,
        code: 'cf-other',
        name: 'CF Other',
        adminRole,
        adminUserId: BigInt(ids['cf-other']!),
      });
      const root = await tx.department.findFirstOrThrow({ where: { tenantId: acmeId } });
      const roleId = nextId();
      await tx.role.create({
        data: {
          id: roleId,
          tenantId: acmeId,
          code: 'cf-sales',
          name: 'cf-sales',
          dataScope: 'SELF',
        },
      });
      await tx.rolePermission.createMany({
        data: SALES_PERMISSIONS.map((permission) => ({ roleId, permission })),
      });
      const memberId = nextId();
      await tx.tenantMember.create({
        data: { id: memberId, tenantId: acmeId, userId: BigInt(ids['cf-sales']!), deptId: root.id },
      });
      await tx.memberRole.create({ data: { tenantId: acmeId, memberId, roleId } });
    });
    const signIn = async (account: string) => {
      const agent = request.agent(app.getHttpServer());
      await agent.post('/api/auth/sign-in').send({ account, password: PASSWORD }).expect(200);
      return agent;
    };
    admin = await signIn('cf-admin');
    sales = await signIn('cf-sales');
    other = await signIn('cf-other');
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
    await prisma.auditLog.deleteMany({ where: { actorUsername: { startsWith: 'cf-' } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [acmeId, otherId] } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map((id) => BigInt(id)) } } });
    await app.close();
  });

  it('gives each tenant the built-in dictionaries, its items to edit and never delete', async () => {
    const [source] = await dictionaries(admin);
    expect(source).toMatchObject({ code: 'crm.customer-source', builtin: true });
    expect(source!.items.map((item) => item.value)).toEqual([
      'ONLINE',
      'REFERRAL',
      'EVENT',
      'OUTBOUND',
      'OTHER',
    ]);
    // Asked again, and by another tenant: still one each.
    expect(await dictionaries(admin)).toHaveLength(1);
    expect(await dictionaries(other)).toHaveLength(1);
    await admin.delete(`/api/dictionaries/${source!.id}`).expect(400);

    const event = source!.items.find((item) => item.value === 'EVENT')!;
    await admin
      .patch(`/api/dictionaries/${source!.id}/items/${event.id}`)
      .send({ label: '展会', enabled: false })
      .expect(200);
    // The sales page reads the source's items, though it can't manage dictionaries.
    await sales.get('/api/dictionaries').expect(403);
    const items = z
      .array(dictionaryItemSchema)
      .parse(
        (await sales.get('/api/dictionaries/builtin/crm.customer-source/items').expect(200)).body,
      );
    expect(items.find((item) => item.value === 'EVENT')).toMatchObject({
      label: '展会',
      enabled: false,
    });
    // Another tenant's copy is its own.
    const [theirs] = await dictionaries(other);
    expect(theirs!.items.find((item) => item.value === 'EVENT')).toMatchObject({ label: '活动' });
  });

  it("checks a customer's source against the dictionary, keeping one disabled since", async () => {
    await sales.post('/api/crm/customers').send({ name: 'cf 甲', source: 'EVENT' }).expect(400);
    await sales.post('/api/crm/customers').send({ name: 'cf 甲', source: 'NOPE' }).expect(400);
    const created = customerSchema.parse(
      (await sales.post('/api/crm/customers').send({ name: 'cf 甲', source: 'ONLINE' }).expect(201))
        .body,
    );
    customerId = created.id;
    expect(created).toMatchObject({ source: 'ONLINE', custom: {} });
  });

  it('lets administrators add dictionaries and fields of every type', async () => {
    regions = dictionarySchema.parse(
      (await admin.post('/api/dictionaries').send({ code: 'region', name: '区域' }).expect(201))
        .body,
    );
    await admin.post('/api/dictionaries').send({ code: 'region', name: '又一个' }).expect(409);
    for (const [value, label] of [
      ['east', '华东'],
      ['south', '华南'],
      ['north', '华北'],
    ]) {
      regions = dictionarySchema.parse(
        (
          await admin
            .post(`/api/dictionaries/${regions.id}/items`)
            .send({ value, label })
            .expect(201)
        ).body,
      );
    }
    await sales
      .post('/api/custom-fields')
      .send({ entity: 'crm.customer', key: 'x', label: 'x', type: 'TEXT' })
      .expect(403);
    await addField(admin, { key: 'region', label: '区域', type: 'SELECT' }).expect(400);
    await addField(admin, {
      key: 'region',
      label: '区域',
      type: 'SELECT',
      dictionaryId: regions.id,
      required: true,
      showInList: true,
    }).expect(201);
    await addField(admin, { key: 'region', label: '重复', type: 'TEXT' }).expect(409);
    await addField(admin, {
      key: 'tags',
      label: '标签',
      type: 'MULTI_SELECT',
      dictionaryId: regions.id,
    }).expect(201);
    await addField(admin, { key: 'budget', label: '预算', type: 'NUMBER', sort: 1 }).expect(201);
    await addField(admin, { key: 'signed_on', label: '签约日', type: 'DATE' }).expect(201);
    await addField(admin, { key: 'vip', label: 'VIP', type: 'BOOLEAN' }).expect(201);
    await addField(admin, { key: 'memo', label: '说明', type: 'TEXTAREA' }).expect(201);

    // Whoever sees customers reads their fields, with the options.
    const listed = await fields(sales, 'crm.customer');
    expect(listed.map((field) => field.key)).toEqual([
      'region',
      'tags',
      'signed_on',
      'vip',
      'memo',
      'budget',
    ]);
    expect(listed[0]!.options.map((option) => option.label)).toEqual(['华东', '华南', '华北']);
    expect(await fields(other, 'crm.customer')).toEqual([]);
    expect((await dictionaries(admin)).find((d) => d.code === 'region')!.usedBy).toEqual([
      { entity: 'crm.customer', label: '客户·区域' },
      { entity: 'crm.customer', label: '客户·标签' },
    ]);
  });

  it('checks the values records give, and keeps them with the record', async () => {
    const create = (custom: object) =>
      sales.post('/api/crm/customers').send({ name: 'cf 乙', custom });
    expect((await create({}).expect(400)).body).toMatchObject({ message: '请填写区域' });
    expect((await create({ region: 'west' }).expect(400)).body).toMatchObject({
      message: '区域的选项不存在或已停用',
    });
    expect(
      (
        await create({ region: 'east', budget: 'lots', signed_on: '2026-02-30', nope: 1 }).expect(
          400,
        )
      ).body.message,
    ).toBe('预算应为数字；签约日应为日期；没有「nope」这个字段');

    const created = customerSchema.parse(
      (
        await create({
          region: 'east',
          tags: ['south', 'north'],
          budget: 5000,
          signed_on: '2026-11-11',
          vip: true,
          memo: '老客户转介绍',
        }).expect(201)
      ).body,
    );
    expect(created.custom).toEqual({
      region: 'east',
      tags: ['south', 'north'],
      budget: 5000,
      signed_on: '2026-11-11',
      vip: true,
      memo: '老客户转介绍',
    });

    // Updating changes the fields given; null clears one; a required one can't be cleared.
    const updated = customerSchema.parse(
      (
        await sales
          .patch(`/api/crm/customers/${created.id}`)
          .send({ custom: { budget: 8000, memo: null } })
          .expect(200)
      ).body,
    );
    expect(updated.custom).toEqual({
      region: 'east',
      tags: ['south', 'north'],
      budget: 8000,
      signed_on: '2026-11-11',
      vip: true,
    });
    await sales
      .patch(`/api/crm/customers/${created.id}`)
      .send({ custom: { region: null } })
      .expect(400);
    // The customer made before the field was required needn't have it, until it's given.
    await sales.patch(`/api/crm/customers/${customerId}`).send({ name: 'cf 甲改' }).expect(200);
  });

  it('keeps values when options are disabled and fields deleted', async () => {
    const south = regions.items.find((item) => item.value === 'south')!;
    await admin
      .patch(`/api/dictionaries/${regions.id}/items/${south.id}`)
      .send({ enabled: false })
      .expect(200);
    const [customer] = (await prisma.customer.findMany({
      where: { tenantId: acmeId, name: 'cf 乙' },
      select: { id: true },
    }))!;
    const id = customer!.id.toString();
    // Kept where it was, refused where new.
    await sales
      .patch(`/api/crm/customers/${id}`)
      .send({ custom: { tags: ['south', 'north'] } })
      .expect(200);
    await sales
      .patch(`/api/crm/customers/${id}`)
      .send({ custom: { region: 'south' } })
      .expect(400);

    await admin.delete(`/api/dictionaries/${regions.id}`).expect(409);
    const budget = (await fields(admin, 'crm.customer')).find((field) => field.key === 'budget')!;
    await admin.delete(`/api/custom-fields/${budget.id}`).expect(204);
    const read = customerSchema.parse(
      (await sales.get(`/api/crm/customers/${id}`).expect(200)).body,
    );
    expect(read.custom['budget']).toBe(8000);
    await sales
      .patch(`/api/crm/customers/${id}`)
      .send({ custom: { budget: 1 } })
      .expect(400);
  });

  it('works the same on contacts', async () => {
    await addField(admin, {
      entity: 'crm.contact',
      key: 'wechat',
      label: '微信',
      type: 'TEXT',
      required: true,
    }).expect(201);
    await sales.post('/api/crm/contacts').send({ customerId, name: 'cf 联系人' }).expect(400);
    const contact = contactSchema.parse(
      (
        await sales
          .post('/api/crm/contacts')
          .send({ customerId, name: 'cf 联系人', custom: { wechat: 'cf_wx' } })
          .expect(201)
      ).body,
    );
    expect(contact.custom).toEqual({ wechat: 'cf_wx' });
  });

  it('hides the fields of a module switched off for the tenant', async () => {
    await prisma.tenant.update({ where: { id: acmeId }, data: { disabledModules: ['crm'] } });
    await app.get(RedisService).incr(`fld:tenant-ctx:ver:${acmeId}`);
    await admin.get('/api/custom-fields').query({ entity: 'crm.customer' }).expect(403);
    await prisma.tenant.update({ where: { id: acmeId }, data: { disabledModules: [] } });
    await app.get(RedisService).incr(`fld:tenant-ctx:ver:${acmeId}`);
  });
});
