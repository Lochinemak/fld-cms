import {
  customerSchema,
  notificationPageSchema,
  pageSchema,
  spreadsheetTaskSchema,
  type PermissionCode,
  type SpreadsheetTask,
} from '@fld/shared';
import type { INestApplication } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { z } from 'zod';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { SnowflakeService } from '../src/snowflake/snowflake.service.js';
import { seedTenant } from '../src/tenants/tenant-seed.js';
import { createTestApp } from './app.js';

type TestAgent = ReturnType<typeof request.agent>;

const PASSWORD = 'xl-test-password';
const VIEWER_PERMISSIONS: PermissionCode[] = ['crm:customer', 'crm:contact'];

/** A workbook in memory, with the rows under the headers. */
async function workbook(headers: string[], rows: unknown[][]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('客户');
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await book.xlsx.writeBuffer());
}

/** The rows of a downloaded workbook's first sheet, as text. */
async function sheetRows(body: Buffer): Promise<string[][]> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(body as unknown as ArrayBuffer);
  const rows: string[][] = [];
  book.worksheets[0]!.eachRow((row) => {
    rows.push(
      (row.values as unknown[]).slice(1).map((value) => {
        if (value instanceof Date) return value.toISOString();
        if (value == null) return '';
        return typeof value === 'object' ? JSON.stringify(value) : String(value as string);
      }),
    );
  });
  return rows;
}

const binary = (res: request.Response, callback: (error: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

// Exports, imports and the notifications they leave, in order. It runs on a tenant and accounts of
// its own (all named xl-*), which it removes afterwards.
describe('Spreadsheets and notifications (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let acmeId: bigint;
  let admin: TestAgent;
  let viewer: TestAgent;
  const ids: Record<string, string> = {};

  const tasks = async (agent: TestAgent) =>
    z.array(spreadsheetTaskSchema).parse((await agent.get('/api/spreadsheets').expect(200)).body);
  /** The task once its job has finished. */
  const finished = (agent: TestAgent, id: string) =>
    vi.waitFor(
      async () => {
        const task = (await tasks(agent)).find((item) => item.id === id);
        if (!task || task.status === 'PENDING' || task.status === 'RUNNING') {
          throw new Error(`Task ${id} still ${task?.status}`);
        }
        return task;
      },
      { timeout: 15_000, interval: 200 },
    );
  const importFile = async (agent: TestAgent, file: Buffer): Promise<SpreadsheetTask> => {
    const res = await agent
      .post('/api/spreadsheets/imports')
      .query({ entity: 'crm.customer' })
      .attach('file', file, '客户.xlsx')
      .expect(201);
    return finished(agent, spreadsheetTaskSchema.parse(res.body).id);
  };
  const notifications = async (agent: TestAgent) =>
    notificationPageSchema.parse((await agent.get('/api/notifications').expect(200)).body);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const snowflake = app.get(SnowflakeService);
    const nextId = () => snowflake.next();
    const passwordHash = await new PasswordHasher().hash(PASSWORD);
    for (const username of ['xl-admin', 'xl-viewer']) {
      const user = await prisma.user.create({
        data: { id: nextId(), username, displayName: username, passwordHash },
      });
      ids[username] = user.id.toString();
    }
    acmeId = nextId();
    await prisma.$transaction(async (tx) => {
      await seedTenant(tx, nextId, {
        id: acmeId,
        code: 'xl-acme',
        name: 'XL Acme',
        adminRole: { code: 'tenant_admin', name: '租户管理员' },
        adminUserId: BigInt(ids['xl-admin']!),
      });
      const root = await tx.department.findFirstOrThrow({ where: { tenantId: acmeId } });
      const roleId = nextId();
      await tx.role.create({
        data: {
          id: roleId,
          tenantId: acmeId,
          code: 'xl-viewer',
          name: 'xl-viewer',
          dataScope: 'SELF',
        },
      });
      await tx.rolePermission.createMany({
        data: VIEWER_PERMISSIONS.map((permission) => ({ roleId, permission })),
      });
      const memberId = nextId();
      await tx.tenantMember.create({
        data: {
          id: memberId,
          tenantId: acmeId,
          userId: BigInt(ids['xl-viewer']!),
          deptId: root.id,
        },
      });
      await tx.memberRole.create({ data: { tenantId: acmeId, memberId, roleId } });
    });
    const signIn = async (account: string) => {
      const agent = request.agent(app.getHttpServer());
      await agent.post('/api/auth/sign-in').send({ account, password: PASSWORD }).expect(200);
      return agent;
    };
    admin = await signIn('xl-admin');
    viewer = await signIn('xl-viewer');

    // A select field, to export and import by its labels.
    const dictionary = (
      await admin.post('/api/dictionaries').send({ code: 'xl_region', name: '区域' }).expect(201)
    ).body as { id: string };
    await admin
      .post(`/api/dictionaries/${dictionary.id}/items`)
      .send({ value: 'east', label: '华东' })
      .expect(201);
    await admin
      .post('/api/custom-fields')
      .send({
        entity: 'crm.customer',
        key: 'region',
        label: '区域',
        type: 'SELECT',
        dictionaryId: dictionary.id,
      })
      .expect(201);
    await admin
      .post('/api/custom-fields')
      .send({ entity: 'crm.customer', key: 'vip', label: 'VIP', type: 'BOOLEAN' })
      .expect(201);
  });

  beforeEach(async () => {
    const redis = app.get(RedisService);
    const keys = await redis.keys('fld:throttle:*');
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    const users = Object.values(ids);
    await prisma.session.deleteMany({ where: { userId: { in: users } } });
    await prisma.auditLog.deleteMany({ where: { actorUsername: { startsWith: 'xl-' } } });
    await prisma.tenant.deleteMany({ where: { id: acmeId } });
    await prisma.user.deleteMany({ where: { id: { in: users.map((id) => BigInt(id)) } } });
    await app.close();
  });

  it('gives a template with the custom fields and what to type in each', async () => {
    await viewer.get('/api/spreadsheets/templates/crm.customer').expect(403);
    const res = await admin
      .get('/api/spreadsheets/templates/crm.customer')
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    const [headers] = await sheetRows(res.body as Buffer);
    expect(headers).toEqual([
      '客户名称',
      '级别',
      '状态',
      '来源',
      '行业',
      '电话',
      '地址',
      '备注',
      '区域',
      'VIP',
    ]);
  });

  it('imports nothing when a row is wrong, and says which', async () => {
    const task = await importFile(
      admin,
      await workbook(
        ['客户名称', '级别', '来源', '区域', 'VIP'],
        [
          ['xl 甲', 'A', '线上', '华东', '是'],
          ['', 'D', '电视', '华西', '也许'],
        ],
      ),
    );
    expect(task).toMatchObject({ status: 'FAILED', rowCount: null });
    expect(task.rowErrors).toEqual([
      {
        row: 3,
        message:
          '级别没有“D”；来源没有“电视”这个选项；请输入客户名称；区域没有“华西”这个选项；VIP应填“是”或“否”',
      },
    ]);
    expect(await prisma.customer.count({ where: { tenantId: acmeId } })).toBe(0);
    const { items } = await notifications(admin);
    expect(items[0]).toMatchObject({ kind: 'import', title: '导入客户失败', read: false });
  });

  it('imports every row of a good file, labels turned into values', async () => {
    const task = await importFile(
      admin,
      await workbook(
        ['客户名称 *', '级别', '状态', '来源', '电话', '区域', 'VIP'],
        [
          ['xl 甲', 'A 重点', '已成交', '线上', '010-1234', '华东', '是'],
          ['xl 乙', '', '', '', '', '', ''],
        ],
      ),
    );
    expect(task).toMatchObject({ status: 'DONE', rowCount: 2 });
    const customers = pageSchema(customerSchema).parse(
      (await admin.get('/api/crm/customers').expect(200)).body,
    ).items;
    expect(
      customers.map((customer) => [
        customer.name,
        customer.level,
        customer.status,
        customer.source,
        customer.custom,
      ]),
    ).toEqual([
      // Empty cells leave fields empty, 是/否 included.
      ['xl 乙', 'B', 'POTENTIAL', null, {}],
      ['xl 甲', 'A', 'WON', 'ONLINE', { region: 'east', vip: true }],
    ]);
    expect(customers.every((customer) => customer.owner.id === ids['xl-admin'])).toBe(true);
  });

  it('exports what the list shows, filters included, for the member to download', async () => {
    await viewer.post('/api/spreadsheets/exports').send({ entity: 'crm.customer' }).expect(403);
    const res = await admin
      .post('/api/spreadsheets/exports')
      .send({ entity: 'crm.customer', query: { level: 'A' } })
      .expect(201);
    const task = await finished(admin, spreadsheetTaskSchema.parse(res.body).id);
    expect(task).toMatchObject({ status: 'DONE', rowCount: 1, downloadable: true });

    // Someone else's export isn't theirs to download.
    await viewer.get(`/api/spreadsheets/${task.id}/download`).expect(404);
    const file = await admin
      .get(`/api/spreadsheets/${task.id}/download`)
      .buffer(true)
      .parse(binary)
      .expect(200);
    const [headers, row] = await sheetRows(file.body as Buffer);
    expect(headers!.slice(0, 4)).toEqual(['客户名称', '级别', '状态', '来源']);
    expect(headers!.slice(-2)).toEqual(['区域', 'VIP']);
    expect(row!.slice(0, 4)).toEqual(['xl 甲', 'A 重点', '已成交', '线上']);
    expect(row!.slice(-2)).toEqual(['华东', '是']);

    const { items, unread } = await notifications(admin);
    expect(items[0]).toMatchObject({
      kind: 'export',
      title: '导出客户完成：共 1 行',
      link: '/spreadsheets',
    });
    expect(unread).toBe(3);
    expect(
      await prisma.auditLog.count({
        where: { tenantId: acmeId, action: { in: ['data.export', 'data.import'] } },
      }),
    ).toBe(2);
  });

  it('marks notifications read, one or all, each member their own', async () => {
    const { items } = await notifications(admin);
    await viewer.post(`/api/notifications/${items[0]!.id}/read`).expect(404);
    await admin.post(`/api/notifications/${items[0]!.id}/read`).expect(204);
    expect((await admin.get('/api/notifications/unread-count').expect(200)).body).toEqual({
      unread: 2,
    });
    await admin.post('/api/notifications/read-all').expect(204);
    expect((await admin.get('/api/notifications/unread-count').expect(200)).body).toEqual({
      unread: 0,
    });
  });

  it('tells the member a customer was handed to them', async () => {
    const customer = (
      await prisma.customer.findFirstOrThrow({ where: { tenantId: acmeId, name: 'xl 甲' } })
    ).id.toString();
    await admin
      .post(`/api/crm/customers/${customer}/transfer`)
      .send({ ownerId: ids['xl-viewer'] })
      .expect(200);
    const { items } = await notifications(viewer);
    expect(items[0]).toMatchObject({
      kind: 'transfer',
      title: 'xl-admin 把客户「xl 甲」转给了你',
      link: `/crm/customers/${customer}`,
    });
  });

  it('exports contacts too, an empty sheet when there are none', async () => {
    const res = await admin
      .post('/api/spreadsheets/exports')
      .send({ entity: 'crm.contact' })
      .expect(201);
    const id = spreadsheetTaskSchema.parse(res.body).id;
    expect(await finished(admin, id)).toMatchObject({ status: 'DONE', rowCount: 0 });
  });
});
