import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  attachmentSchema,
  fileFolderDetailSchema,
  fileFolderSchema,
  fileShareSchema,
  pageSchema,
  publicShareSchema,
  storedFileDetailSchema,
  storedFileSchema,
  type PermissionCode,
} from '@fld/shared';
import type { INestApplication } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { z } from 'zod';
import { FilePurgeService } from '../src/files/file-purge.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { SnowflakeService } from '../src/snowflake/snowflake.service.js';
import { Storage } from '../src/storage/storage.js';
import { seedTenant } from '../src/tenants/tenant-seed.js';
import { createTestApp } from './app.js';

type TestAgent = ReturnType<typeof request.agent>;

const PASSWORD = 'files-test-password';
const DAY = 86_400_000;
const USERNAMES = [
  'files-admin',
  'files-manager',
  'files-east',
  'files-west',
  'files-viewer',
  'files-helper',
];
const filePageSchema = pageSchema(storedFileSchema);

const FILE_PERMISSIONS: PermissionCode[] = [
  'file:library',
  'file:library:upload',
  'file:library:folder',
  'file:library:edit',
  'file:library:replace',
  'file:library:delete',
  'file:library:share',
];
const SALES_PERMISSIONS: PermissionCode[] = [
  ...FILE_PERMISSIONS,
  'crm:customer',
  'crm:customer:create',
  'crm:customer:update',
];
const MANAGER_PERMISSIONS: PermissionCode[] = [...SALES_PERMISSIONS, 'crm:customer:delete'];

// The story of one tenant's file library: Sales has East and West under it. The manager sees the
// whole of Sales; East and West see only what they own; the viewer may not open the library but
// sees East's customers. A second tenant checks isolation. Both tenants and their accounts (all
// named files-*) are removed afterwards, stored contents included.
describe('Files (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let acmeId: bigint;
  let otherId: bigint;
  const userIds: Record<string, bigint> = {};
  const agents: Record<string, TestAgent> = {};
  /** Ids of the records the story creates, by name. */
  const ids: Record<string, string> = {};
  const storageDir = process.env['STORAGE_LOCAL_DIR']!;

  const agent = (username: string) => agents[username]!;
  const id = (name: string) => ids[name]!;
  const anonymous = () => request(app.getHttpServer());
  const upload = async (as: TestAgent, name: string, content: string, folderId?: string) =>
    storedFileSchema.parse(
      (
        await as
          .post(folderId ? `/api/files?folderId=${folderId}` : '/api/files')
          .attach('file', Buffer.from(content), name)
          .expect(201)
      ).body,
    );
  const fileNames = async (as: TestAgent, query = '') =>
    filePageSchema
      .parse((await as.get(`/api/files${query}`).expect(200)).body)
      .items.map(({ name }) => name)
      .sort();
  const recentFiles = async (as: TestAgent) =>
    z.array(storedFileSchema).parse((await as.get('/api/files/recent').expect(200)).body);
  const recentNames = async (as: TestAgent) => (await recentFiles(as)).map(({ name }) => name);
  const folderNames = async (as: TestAgent, query = '') =>
    z
      .array(fileFolderSchema)
      .parse((await as.get(`/api/files/folders${query}`).expect(200)).body)
      .map(({ name }) => name)
      .sort();
  const getFile = async (as: TestAgent, name: string) =>
    storedFileDetailSchema.parse((await as.get(`/api/files/${id(name)}`).expect(200)).body);
  const createFolder = async (as: TestAgent, name: string, parentId: string | null = null) =>
    fileFolderSchema.parse(
      (await as.post('/api/files/folders').send({ name, parentId }).expect(201)).body,
    );
  /** The body of a response, whatever its type. */
  const text = (res: request.Response) => (res.body as Buffer).toString();
  const attachmentsOf = async (as: TestAgent, customer: string) =>
    z
      .array(attachmentSchema)
      .parse((await as.get(`/api/crm/customers/${id(customer)}/attachments`).expect(200)).body);

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
    otherId = nextId();
    await prisma.$transaction(async (tx) => {
      const adminRole = { code: 'tenant_admin', name: '租户管理员' };
      await seedTenant(tx, nextId, {
        id: acmeId,
        code: 'files-acme',
        name: 'Acme',
        adminRole,
        adminUserId: userIds['files-admin']!,
      });
      await seedTenant(tx, nextId, {
        id: otherId,
        code: 'files-other',
        name: 'Other',
        adminRole,
        adminUserId: userIds['files-helper']!,
      });
      const addDept = async (name: string, parent: { id: bigint; path: string }) => {
        const id = nextId();
        return tx.department.create({
          data: { id, tenantId: acmeId, parentId: parent.id, name, path: `${parent.path}${id}/` },
        });
      };
      const root = await tx.department.findFirstOrThrow({ where: { tenantId: acmeId } });
      const sales = await addDept('Sales', root);
      const east = await addDept('East', sales);
      const west = await addDept('West', sales);
      const addRole = async (
        code: string,
        dataScope: 'DEPT_AND_CHILDREN' | 'DEPT' | 'SELF',
        permissions: PermissionCode[],
      ) => {
        const id = nextId();
        await tx.role.create({ data: { id, tenantId: acmeId, code, name: code, dataScope } });
        await tx.rolePermission.createMany({
          data: permissions.map((permission) => ({ roleId: id, permission })),
        });
        return id;
      };
      const managerRole = await addRole('files-manager', 'DEPT_AND_CHILDREN', MANAGER_PERMISSIONS);
      const salesRole = await addRole('files-sales', 'SELF', SALES_PERMISSIONS);
      const viewerRole = await addRole('files-viewer', 'DEPT', ['crm:customer']);
      const members: [string, bigint, bigint][] = [
        ['files-manager', sales.id, managerRole],
        ['files-east', east.id, salesRole],
        ['files-west', west.id, salesRole],
        ['files-viewer', east.id, viewerRole],
      ];
      for (const [username, deptId, roleId] of members) {
        const memberId = nextId();
        await tx.tenantMember.create({
          data: { id: memberId, tenantId: acmeId, userId: userIds[username]!, deptId },
        });
        await tx.memberRole.create({ data: { tenantId: acmeId, memberId, roleId } });
      }
    });
    for (const username of USERNAMES) {
      const signedIn = request.agent(app.getHttpServer());
      await signedIn
        .post('/api/auth/sign-in')
        .send({ account: username, password: PASSWORD })
        .expect(200);
      agents[username] = signedIn;
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
      where: { username: { startsWith: 'files-' } },
      select: { id: true },
    });
    await prisma.session.deleteMany({
      where: { userId: { in: users.map(({ id }) => id.toString()) } },
    });
    await prisma.tenant.deleteMany({ where: { id: { in: [acmeId, otherId] } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(({ id }) => id) } } });
    for (const tenantId of [acmeId, otherId]) {
      await rm(join(storageDir, 'files', tenantId.toString()), { recursive: true, force: true });
    }
    await app.close();
  });

  it('keeps uploads at the top level for their uploader, numbering names already taken', async () => {
    const east = agent('files-east');
    const contract = await upload(east, '合同.pdf', '%PDF-east-v1');
    expect(contract).toMatchObject({
      name: '合同.pdf',
      folder: null,
      size: 12,
      mimeType: 'application/pdf',
      version: 1,
      owner: { displayName: 'files-east' },
      creator: { displayName: 'files-east' },
      dept: { name: 'East' },
    });
    ids['合同.pdf'] = contract.id;
    for (const [name, saved] of [
      ['合同.pdf', '合同 (1).pdf'],
      ['合同.PDF', '合同 (2).PDF'],
    ]) {
      const copy = await upload(east, name!, 'copy');
      expect(copy.name).toBe(saved);
      ids[saved!] = copy.id;
    }
    // West's top level is West's own.
    const west = agent('files-west');
    ids['west/合同.pdf'] = (await upload(west, '合同.pdf', 'west')).id;
    ids['notes.txt'] = (await upload(west, 'notes.txt', 'west notes')).id;

    expect(await fileNames(east)).toEqual(['合同 (1).pdf', '合同 (2).PDF', '合同.pdf']);
    expect(await fileNames(west)).toEqual(['notes.txt', '合同.pdf']);
    expect(await fileNames(agent('files-manager'))).toHaveLength(5);
    expect(await fileNames(agent('files-admin'))).toHaveLength(5);
  });

  it('refuses executables, requests without a file and files over the limit', async () => {
    const east = agent('files-east');
    for (const name of ['setup.exe', 'run.sh', 'tool.JAR']) {
      const res = await east.post('/api/files').attach('file', Buffer.from('x'), name).expect(400);
      expect(res.body.message).toBe('不允许使用可执行程序和脚本的扩展名');
    }
    expect((await east.post('/api/files').expect(400)).body.message).toBe('请选择文件');
    const tooBig = await east
      .post('/api/files')
      .attach('file', Buffer.alloc(1024 * 1024 + 1), 'big.bin')
      .expect(413);
    expect(tooBig.body.message).toBe('文件不能超过 1 MB');
    await agent('files-viewer')
      .post('/api/files')
      .attach('file', Buffer.from('x'), 'a.txt')
      .expect(403);
    expect(await fileNames(east)).toHaveLength(3);
  });

  it('serves contents to whoever sees the file, previewing only what is safe to', async () => {
    const east = agent('files-east');
    const url = `/api/files/${id('合同.pdf')}/content`;
    const pdf = await east.get(url).responseType('blob').expect(200);
    expect(pdf.headers).toMatchObject({
      'content-type': 'application/pdf',
      'content-length': '12',
      'content-disposition': `inline; filename="__.pdf"; filename*=UTF-8''%E5%90%88%E5%90%8C.pdf`,
      'x-content-type-options': 'nosniff',
    });
    expect(text(pdf)).toBe('%PDF-east-v1');
    const download = await east.get(`${url}?download=true`).responseType('blob').expect(200);
    expect(download.headers['content-disposition']).toMatch(/^attachment; /);

    const part = await east.get(url).set('Range', 'bytes=0-3').responseType('blob').expect(206);
    expect(part.headers['content-range']).toBe('bytes 0-3/12');
    expect(text(part)).toBe('%PDF');
    await east.get(url).set('Range', 'bytes=100-200').expect(416);

    const notes = await agent('files-west')
      .get(`/api/files/${id('notes.txt')}/content`)
      .responseType('blob')
      .expect(200);
    expect(notes.headers['content-type']).toMatch(/^text\/plain/);
    expect(notes.headers['content-disposition']).toMatch(/^attachment; /);

    await agent('files-west').get(url).expect(404);
    await agent('files-viewer').get(url).expect(403);
  });

  it('hands what a folder holds to its owner, remembering who put it there', async () => {
    const east = agent('files-east');
    const project = await createFolder(east, '项目');
    expect(project).toMatchObject({
      parentId: null,
      owner: { displayName: 'files-east' },
      dept: { name: 'East' },
    });
    ids['项目'] = project.id;
    ids['项目/合同'] = (await createFolder(east, '合同', project.id)).id;

    const plan = await upload(agent('files-manager'), 'plan.txt', 'the plan', id('项目/合同'));
    expect(plan).toMatchObject({
      folder: { id: id('项目/合同'), name: '合同' },
      owner: { displayName: 'files-east' },
      creator: { displayName: 'files-manager' },
      dept: { name: 'East' },
    });
    ids['plan.txt'] = plan.id;
    expect(await fileNames(east, `?folderId=${id('项目/合同')}`)).toEqual(['plan.txt']);
    expect((await getFile(east, 'plan.txt')).path.map(({ name }) => name)).toEqual([
      '项目',
      '合同',
    ]);
    const folder = fileFolderDetailSchema.parse(
      (await east.get(`/api/files/folders/${id('项目/合同')}`).expect(200)).body,
    );
    expect(folder.path.map(({ name }) => name)).toEqual(['项目']);
    expect(await folderNames(east, `?parentId=${project.id}`)).toEqual(['合同']);

    const taken = await east.post('/api/files/folders').send({ name: '项目' }).expect(409);
    expect(taken.body.message).toBe('这里已有同名文件夹');
    await createFolder(east, 'Docs');
    await east.post('/api/files/folders').send({ name: 'docs' }).expect(409);

    const west = agent('files-west');
    ids['west/项目'] = (await createFolder(west, '项目')).id;
    expect(await folderNames(west)).toEqual(['项目']);
    await west.get(`/api/files/folders/${project.id}`).expect(404);
    await west.get(`/api/files?folderId=${project.id}`).expect(404);
    await west
      .post(`/api/files?folderId=${project.id}`)
      .attach('file', Buffer.from('x'), 'x.txt')
      .expect(404);
    expect(await folderNames(agent('files-manager'))).toEqual(['Docs', '项目', '项目']);
  });

  it('renames and moves files, handing them to the folder they go to', async () => {
    const east = agent('files-east');
    const renamed = await east
      .patch(`/api/files/${id('合同 (1).pdf')}`)
      .send({ name: '旧合同.pdf' })
      .expect(200);
    expect(storedFileSchema.parse(renamed.body).name).toBe('旧合同.pdf');
    const taken = await east
      .patch(`/api/files/${id('合同 (2).PDF')}`)
      .send({ name: '合同.PDF' })
      .expect(409);
    expect(taken.body.message).toBe('这里已有同名文件');
    await east
      .patch(`/api/files/${id('合同 (2).PDF')}`)
      .send({ name: 'tool.exe' })
      .expect(400);
    await east
      .patch(`/api/files/${id('合同 (2).PDF')}`)
      .send({})
      .expect(400);

    const moved = await east
      .patch(`/api/files/${id('合同 (1).pdf')}`)
      .send({ folderId: id('项目') })
      .expect(200);
    expect(storedFileSchema.parse(moved.body).folder?.name).toBe('项目');

    // Back at the top level, a file is its creator's again.
    const manager = agent('files-manager');
    const plan = await manager
      .patch(`/api/files/${id('plan.txt')}`)
      .send({ folderId: null })
      .expect(200);
    expect(storedFileSchema.parse(plan.body)).toMatchObject({
      folder: null,
      owner: { displayName: 'files-manager' },
      dept: { name: 'Sales' },
    });
    await east.get(`/api/files/${id('plan.txt')}`).expect(404);

    // In someone else's folder, it is theirs.
    const notes = await manager
      .patch(`/api/files/${id('notes.txt')}`)
      .send({ folderId: id('项目') })
      .expect(200);
    expect(storedFileSchema.parse(notes.body).owner.displayName).toBe('files-east');
    await agent('files-west')
      .get(`/api/files/${id('notes.txt')}`)
      .expect(404);
    await east.get(`/api/files/${id('notes.txt')}`).expect(200);
    await agent('files-west')
      .patch(`/api/files/${id('west/合同.pdf')}`)
      .send({ folderId: id('项目') })
      .expect(404);
  });

  it('moves folders with everything in them, but never into themselves', async () => {
    const east = agent('files-east');
    for (const parentId of [id('项目/合同'), id('项目')]) {
      const res = await east
        .patch(`/api/files/folders/${id('项目')}`)
        .send({ parentId })
        .expect(400);
      expect(res.body.message).toBe('不能把文件夹移到它自己或它的子文件夹里');
    }

    const west = agent('files-west');
    ids['draft.txt'] = (await upload(west, 'draft.txt', 'draft', id('west/项目'))).id;
    const manager = agent('files-manager');
    const moved = await manager
      .patch(`/api/files/folders/${id('west/项目')}`)
      .send({ parentId: id('项目') })
      .expect(200);
    expect(fileFolderSchema.parse(moved.body)).toMatchObject({
      parentId: id('项目'),
      owner: { displayName: 'files-east' },
    });
    expect((await getFile(east, 'draft.txt')).owner.displayName).toBe('files-east');
    await west.get(`/api/files/${id('draft.txt')}`).expect(404);

    // Renaming leaves owners be; back at the top level, the folder and all in it go to its creator.
    await east
      .patch(`/api/files/folders/${id('west/项目')}`)
      .send({ name: '草稿' })
      .expect(200);
    const back = await manager
      .patch(`/api/files/folders/${id('west/项目')}`)
      .send({ parentId: null })
      .expect(200);
    expect(fileFolderSchema.parse(back.body)).toMatchObject({
      name: '草稿',
      parentId: null,
      owner: { displayName: 'files-west' },
    });
    expect((await getFile(west, 'draft.txt')).owner.displayName).toBe('files-west');
  });

  it('searches every folder the user can see by name', async () => {
    expect(await fileNames(agent('files-east'), '?keyword=合同')).toEqual([
      '合同 (2).PDF',
      '合同.pdf',
      '旧合同.pdf',
    ]);
    expect(await fileNames(agent('files-manager'), '?keyword=合同')).toEqual([
      '合同 (2).PDF',
      '合同.pdf',
      '合同.pdf',
      '旧合同.pdf',
    ]);
    expect(await fileNames(agent('files-west'), '?keyword=合同')).toEqual(['合同.pdf']);
  });

  it('replaces contents as new versions, keeping the current one and 10 before it', async () => {
    const east = agent('files-east');
    const url = `/api/files/${id('合同.pdf')}`;
    const replace = (name: string, content: string) =>
      east.post(`${url}/versions`).attach('file', Buffer.from(content), name);
    const contentOf = async (path: string) =>
      text(await east.get(`${url}${path}`).responseType('blob').expect(200));

    expect((await replace('合同.docx', 'x').expect(400)).body.message).toBe(
      '只能替换为同类型的文件（.pdf）',
    );
    const second = storedFileDetailSchema.parse(
      (await replace('new.PDF', '%PDF-east-v2').expect(201)).body,
    );
    expect(second).toMatchObject({ id: id('合同.pdf'), name: '合同.pdf', version: 2 });
    expect(second.versions.map(({ number }) => number)).toEqual([2, 1]);
    expect(await contentOf('/content')).toBe('%PDF-east-v2');
    const first = second.versions[1]!;
    expect(await contentOf(`/versions/${first.id}/content`)).toBe('%PDF-east-v1');
    const { storageKey } = await prisma.fileVersion.findUniqueOrThrow({
      where: { id: BigInt(first.id) },
    });
    expect(existsSync(join(storageDir, storageKey))).toBe(true);

    const restored = storedFileDetailSchema.parse(
      (await east.post(`${url}/versions/${first.id}/restore`).expect(200)).body,
    );
    expect(restored.versions[0]).toMatchObject({
      number: 3,
      restoredFrom: 1,
      uploader: { displayName: 'files-east' },
    });
    expect(await contentOf('/content')).toBe('%PDF-east-v1');
    const current = await east.post(`${url}/versions/${restored.versions[0]!.id}/restore`);
    expect(current.status).toBe(400);
    expect(current.body.message).toBe('这已经是当前版本');

    for (let number = 4; number <= 13; number++) {
      await replace('合同.pdf', `%PDF-east-v${number}`).expect(201);
    }
    const latest = await getFile(east, '合同.pdf');
    expect(latest.versions.map(({ number }) => number)).toEqual([
      13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3,
    ]);
    expect(await contentOf('/content')).toBe('%PDF-east-v13');
    await east.get(`${url}/versions/${first.id}/content`).expect(404);
    expect(existsSync(join(storageDir, storageKey))).toBe(false);

    await agent('files-west')
      .post(`${url}/versions`)
      .attach('file', Buffer.from('x'), 'x.pdf')
      .expect(404);
    await agent('files-viewer')
      .post(`${url}/versions`)
      .attach('file', Buffer.from('x'), 'x.pdf')
      .expect(403);
  });

  it('shares files through links that open without signing in', async () => {
    const east = agent('files-east');
    const url = `/api/files/${id('合同.pdf')}/shares`;
    const open = (token: string, query = '') =>
      anonymous().get(`/api/public/shares/${token}${query}`);

    const share = fileShareSchema.parse((await east.post(url).send({}).expect(201)).body);
    expect(share).toMatchObject({
      code: null,
      accessCount: 0,
      creator: { displayName: 'files-east' },
    });
    expect(Date.parse(share.expiresAt!) - Date.now()).toBeGreaterThan(7 * DAY - 60_000);
    expect(publicShareSchema.parse((await open(share.token).expect(200)).body)).toEqual({
      codeRequired: false,
      expiresAt: share.expiresAt,
      file: { name: '合同.pdf', size: 13, mimeType: 'application/pdf' },
    });
    const content = await open(share.token, '/content').responseType('blob').expect(200);
    expect(content.headers['content-disposition']).toMatch(/^inline; /);
    expect(text(content)).toBe('%PDF-east-v13');
    const [listed] = z.array(fileShareSchema).parse((await east.get(url).expect(200)).body);
    expect(listed).toMatchObject({ id: share.id, accessCount: 1 });
    expect(listed!.lastAccessedAt).not.toBeNull();

    const coded = fileShareSchema.parse(
      (await east.post(url).send({ expiresInDays: null, withCode: true }).expect(201)).body,
    );
    expect(coded.expiresAt).toBeNull();
    expect(coded.code).toMatch(/^[A-HJKMNP-Z2-9]{4}$/);
    const code = coded.code!;
    expect(publicShareSchema.parse((await open(coded.token).expect(200)).body)).toEqual({
      codeRequired: true,
      expiresAt: null,
      file: null,
    });
    const wrong = await open(coded.token, `?code=${code === 'AAAA' ? 'BBBB' : 'AAAA'}`).expect(403);
    expect(wrong.body.message).toBe('提取码不正确');
    const opened = await open(coded.token, `?code=${code.toLowerCase()}`).expect(200);
    expect(publicShareSchema.parse(opened.body).file?.name).toBe('合同.pdf');
    await open(coded.token, '/content').expect(403);
    await open(coded.token, `/content?code=${code}`).expect(200);

    // Revoked, expired or of a disabled tenant, a link is gone.
    await east.delete(`/api/files/shares/${coded.id}`).expect(204);
    expect((await open(coded.token).expect(404)).body.message).toBe('链接不存在或已失效');
    const where = { id: BigInt(share.id) };
    await prisma.fileShare.update({ where, data: { expiresAt: new Date(Date.now() - 1000) } });
    await open(share.token).expect(404);
    await prisma.fileShare.update({ where, data: { expiresAt: null } });
    await prisma.tenant.update({ where: { id: acmeId }, data: { status: 'DISABLED' } });
    await open(share.token).expect(404);
    await prisma.tenant.update({ where: { id: acmeId }, data: { status: 'ACTIVE' } });
    await open(share.token).expect(200);
    ids['share'] = share.token;

    await agent('files-west').post(url).send({}).expect(404);
    await agent('files-west').delete(`/api/files/shares/${share.id}`).expect(404);
    await agent('files-viewer').get(url).expect(403);
    await open('no-such-link').expect(404);
  });

  it('attaches files to customers, for everyone who sees the customer', async () => {
    const east = agent('files-east');
    const manager = agent('files-manager');
    const viewer = agent('files-viewer');
    for (const [username, name] of [
      ['files-east', 'East Co'],
      ['files-west', 'West Co'],
    ] as const) {
      const customer = await agent(username).post('/api/crm/customers').send({ name }).expect(201);
      ids[name] = z.object({ id: z.string() }).parse(customer.body).id;
    }
    const brief = await upload(manager, 'brief.pdf', '%PDF-brief');
    ids['brief.pdf'] = brief.id;
    const url = `/api/crm/customers/${id('East Co')}/attachments`;

    const attached = await manager
      .post(url)
      .send({ fileIds: [brief.id] })
      .expect(201);
    expect(z.array(attachmentSchema).parse(attached.body)).toEqual([
      expect.objectContaining({
        file: { id: brief.id, name: 'brief.pdf', size: 10, mimeType: 'application/pdf' },
        attachedBy: expect.objectContaining({ displayName: 'files-manager' }),
      }),
    ]);
    // The viewer may not open the library and East's data scope leaves the brief out, yet both see
    // the customer, so both open its attachments.
    for (const as of [viewer, east]) {
      expect((await attachmentsOf(as, 'East Co')).map(({ file }) => file.name)).toEqual([
        'brief.pdf',
      ]);
      const content = await as.get(`${url}/${brief.id}/content`).responseType('blob').expect(200);
      expect(text(content)).toBe('%PDF-brief');
    }
    await viewer.get(`/api/files/${brief.id}`).expect(403);
    await east.get(`/api/files/${brief.id}`).expect(404);
    await agent('files-west').get(url).expect(404);
    await east.get(`${url}/${id('合同.pdf')}/content`).expect(404);

    // Only files the user sees, each once.
    const unseen = await east
      .post(url)
      .send({ fileIds: [id('west/合同.pdf')] })
      .expect(404);
    expect(unseen.body.message).toBe('文件不存在');
    await east
      .post(url)
      .send({ fileIds: [id('合同.pdf'), id('合同.pdf')] })
      .expect(201);
    await east
      .post(url)
      .send({ fileIds: [id('合同.pdf')] })
      .expect(201);
    expect(await attachmentsOf(east, 'East Co')).toHaveLength(2);
    await east.post(url).send({ fileIds: [] }).expect(400);
    await viewer
      .post(url)
      .send({ fileIds: [brief.id] })
      .expect(403);
  });

  it('keeps files in use from being deleted, saying where they are used', async () => {
    const east = agent('files-east');
    const manager = agent('files-manager');
    expect((await east.delete(`/api/files/${id('合同.pdf')}`).expect(409)).body.message).toBe(
      '该文件正在被使用，不能删除。用在：客户「East Co」',
    );

    // East cannot see West Co, which the manager attaches East's old contract to.
    const westUrl = `/api/crm/customers/${id('West Co')}/attachments`;
    await manager
      .post(westUrl)
      .send({ fileIds: [id('合同 (1).pdf')] })
      .expect(201);
    expect(await getFile(manager, '合同 (1).pdf')).toMatchObject({
      usages: [{ type: 'CUSTOMER', id: id('West Co'), name: 'West Co' }],
      hiddenUsages: 0,
    });
    expect(await getFile(east, '合同 (1).pdf')).toMatchObject({ usages: [], hiddenUsages: 1 });
    expect((await east.delete(`/api/files/${id('合同 (1).pdf')}`).expect(409)).body.message).toBe(
      '该文件正在被使用，不能删除。用在：1 处你看不到的记录',
    );
    const folder = await east.delete(`/api/files/folders/${id('项目')}`).expect(409);
    expect(folder.body.message).toBe(
      '文件夹里有 1 个文件正在被使用，不能删除。比如「旧合同.pdf」用在：1 处你看不到的记录',
    );

    await manager.delete(`${westUrl}/${id('合同 (1).pdf')}`).expect(204);
    expect(
      (await manager.delete(`${westUrl}/${id('合同 (1).pdf')}`).expect(404)).body.message,
    ).toBe('附件不存在');
    await agent('files-viewer')
      .delete(`/api/crm/customers/${id('East Co')}/attachments/${id('brief.pdf')}`)
      .expect(403);

    // A deleted customer takes its attachments off with it; the files stay.
    await manager.delete(`/api/crm/customers/${id('East Co')}`).expect(204);
    expect(await prisma.fileRef.count({ where: { tenantId: acmeId } })).toBe(0);
    await manager.get(`/api/files/${id('brief.pdf')}`).expect(200);
  });

  it('deletes files and folders, and the links to them along with them', async () => {
    const east = agent('files-east');
    await east.delete(`/api/files/${id('合同.pdf')}`).expect(204);
    await anonymous()
      .get(`/api/public/shares/${id('share')}`)
      .expect(404);
    expect(await prisma.fileShare.count({ where: { fileId: BigInt(id('合同.pdf')) } })).toBe(0);
    await east.get(`/api/files/${id('合同.pdf')}`).expect(404);
    await east.get(`/api/files/${id('合同.pdf')}/content`).expect(404);
    expect(await fileNames(east)).toEqual(['合同 (2).PDF']);

    const inside = fileShareSchema.parse(
      (
        await east
          .post(`/api/files/${id('notes.txt')}/shares`)
          .send({})
          .expect(201)
      ).body,
    );
    await agent('files-viewer')
      .delete(`/api/files/folders/${id('项目')}`)
      .expect(403);
    await agent('files-west')
      .delete(`/api/files/folders/${id('项目')}`)
      .expect(404);
    await east.delete(`/api/files/folders/${id('项目')}`).expect(204);
    for (const folder of ['项目', '项目/合同']) {
      await east.get(`/api/files/folders/${id(folder)}`).expect(404);
    }
    for (const file of ['合同 (1).pdf', 'notes.txt']) {
      await east.get(`/api/files/${id(file)}`).expect(404);
    }
    await anonymous().get(`/api/public/shares/${inside.token}`).expect(404);
    expect(await folderNames(east)).toEqual(['Docs']);
  });

  it('purges what has been deleted for 30 days, stored contents included', async () => {
    const where = { tenantId: acmeId, deletedAt: { not: null } };
    const deleted = await prisma.storedFile.findMany({
      where,
      select: { id: true, versions: { select: { storageKey: true } } },
    });
    expect(deleted).toHaveLength(3);
    const keys = deleted.flatMap(({ versions }) => versions.map(({ storageKey }) => storageKey));
    expect(keys).toHaveLength(13);
    expect(keys.every((key) => existsSync(join(storageDir, key)))).toBe(true);

    const purge = app.get(FilePurgeService);
    await purge.purge(new Date(Date.now() + 29 * DAY));
    expect(await prisma.storedFile.count({ where })).toBe(3);

    // A file whose contents could not be removed keeps its row, to be tried again.
    const remove = vi
      .spyOn(app.get(Storage), 'remove')
      .mockRejectedValueOnce(new Error('storage unavailable'));
    await purge.purge(new Date(Date.now() + 31 * DAY));
    expect(await prisma.storedFile.count({ where })).toBe(1);
    remove.mockRestore();

    await purge.purge(new Date(Date.now() + 31 * DAY));
    expect(await prisma.storedFile.count({ where })).toBe(0);
    expect(await prisma.fileFolder.count({ where })).toBe(0);
    expect(
      await prisma.fileVersion.count({ where: { fileId: { in: deleted.map(({ id }) => id) } } }),
    ).toBe(0);
    expect(keys.some((key) => existsSync(join(storageDir, key)))).toBe(false);
    const kept = await agent('files-east')
      .get(`/api/files/${id('合同 (2).PDF')}/content`)
      .responseType('blob')
      .expect(200);
    expect(text(kept)).toBe('copy');
  });

  it('lists the 10 files changed last, to whoever sees them', async () => {
    const east = agent('files-east');
    const west = agent('files-west');
    const manager = agent('files-manager');
    const url = (name: string) => `/api/files/${id(name)}`;
    // What is left of the story, the file touched last first.
    expect(await recentNames(west)).toEqual(['draft.txt', '合同.pdf']);
    expect(await recentNames(east)).toEqual(['合同 (2).PDF']);
    expect(await recentNames(manager)).toEqual([
      'brief.pdf',
      'draft.txt',
      'plan.txt',
      '合同.pdf',
      '合同 (2).PDF',
    ]);

    const uploads: string[] = [];
    for (let number = 1; number <= 9; number++) {
      const name = `recent-${number}.txt`;
      ids[name] = (await upload(west, name, 'x')).id;
      uploads.unshift(name);
    }
    // With 11 files, the one touched longest ago is left out.
    expect(await recentNames(west)).toEqual([...uploads, 'draft.txt']);

    // Renaming a file, replacing its contents, moving it and restoring a version all bring it up.
    await west.patch(url('west/合同.pdf')).send({ name: '新合同.pdf' }).expect(200);
    expect(await recentNames(west)).toEqual(['新合同.pdf', ...uploads]);
    const replaced = storedFileDetailSchema.parse(
      (
        await west
          .post(`${url('draft.txt')}/versions`)
          .attach('file', Buffer.from('second draft'), 'draft.txt')
          .expect(201)
      ).body,
    );
    expect(await recentNames(west)).toEqual(['draft.txt', '新合同.pdf', ...uploads.slice(0, 8)]);
    await west
      .patch(url('recent-1.txt'))
      .send({ folderId: id('west/项目') })
      .expect(200);
    expect((await recentFiles(west))[0]).toMatchObject({
      name: 'recent-1.txt',
      folder: { id: id('west/项目'), name: '草稿' },
    });
    await west.post(`${url('draft.txt')}/versions/${replaced.versions[1]!.id}/restore`).expect(200);
    expect(await recentNames(west)).toEqual([
      'draft.txt',
      'recent-1.txt',
      '新合同.pdf',
      ...uploads.slice(0, 7),
    ]);

    // A deleted file makes room for the next one.
    await west.delete(url('recent-1.txt')).expect(204);
    const latest = ['draft.txt', '新合同.pdf', ...uploads.slice(0, 8)];
    expect(await recentNames(west)).toEqual(latest);

    // The manager sees West's files too, East only its own, and the viewer may not look.
    expect(await recentNames(manager)).toEqual(latest);
    expect(await recentNames(east)).toEqual(['合同 (2).PDF']);
    await agent('files-viewer').get('/api/files/recent').expect(403);
  });

  it('keeps other tenants out', async () => {
    const helper = agent('files-helper');
    expect(await fileNames(helper)).toEqual([]);
    expect(await recentNames(helper)).toEqual([]);
    expect(await folderNames(helper)).toEqual([]);
    await helper.get(`/api/files/${id('合同 (2).PDF')}`).expect(404);
    await helper.get(`/api/files/${id('合同 (2).PDF')}/content`).expect(404);
    await helper
      .patch(`/api/files/${id('合同 (2).PDF')}`)
      .send({ name: 'x.pdf' })
      .expect(404);
    await helper.get(`/api/files/folders/${id('west/项目')}`).expect(404);
    await helper
      .post(`/api/files/${id('合同 (2).PDF')}/shares`)
      .send({})
      .expect(404);
  });
});
