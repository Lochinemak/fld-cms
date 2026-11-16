import { DEFAULT_TABLE_PREFERENCE, tablePreferenceSchema } from '@fld/shared';
import type { INestApplication } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SnowflakeService } from '../src/snowflake/snowflake.service.js';
import { seedTenant } from '../src/tenants/tenant-seed.js';
import { createTestApp } from './app.js';

type TestAgent = ReturnType<typeof request.agent>;

const PASSWORD = 'pref-test-password';
const USERNAMES = ['pref-ann', 'pref-bob'];
const TABLE = '/api/preferences/tables/crm.customer';

// Two tenants, each with one admin: what one member saves is theirs alone. Both tenants and
// their accounts (named pref-*) are removed afterwards.
describe('Preferences (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const tenantIds: bigint[] = [];
  const agents: Record<string, TestAgent> = {};

  const tableOf = async (as: TestAgent, path = TABLE) =>
    tablePreferenceSchema.parse((await as.get(path).expect(200)).body);

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
      const tenantId = nextId();
      tenantIds.push(tenantId);
      await prisma.$transaction((tx) =>
        seedTenant(tx, nextId, {
          id: tenantId,
          code: username,
          name: username,
          adminRole: { code: 'tenant_admin', name: '租户管理员' },
          adminUserId: user.id,
        }),
      );
      const signedIn = request.agent(app.getHttpServer());
      await signedIn
        .post('/api/auth/sign-in')
        .send({ account: username, password: PASSWORD })
        .expect(200);
      agents[username] = signedIn;
    }
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { username: { startsWith: 'pref-' } },
      select: { id: true },
    });
    await prisma.session.deleteMany({
      where: { userId: { in: users.map(({ id }) => id.toString()) } },
    });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(({ id }) => id) } } });
    await app.close();
  });

  it('keeps what a member set up for a table, for that member and table alone', async () => {
    const ann = agents['pref-ann']!;
    expect(await tableOf(ann)).toEqual(DEFAULT_TABLE_PREFERENCE);

    const hidden = {
      columns: { level: false, phone: true, 'custom:region': true },
      sort: { column: 'name', order: 'desc' },
    };
    expect((await ann.put(TABLE).send(hidden).expect(200)).body).toEqual(hidden);
    expect(await tableOf(ann)).toEqual(hidden);

    // Saving again replaces the whole preference.
    const shown = { columns: {}, sort: null };
    await ann.put(TABLE).send(shown).expect(200);
    await ann.put(TABLE).send(hidden).expect(200);
    expect(await tableOf(ann)).toEqual(hidden);
    expect(await prisma.userPreference.count({ where: { tenantId: tenantIds[0]! } })).toBe(1);

    expect(await tableOf(ann, '/api/preferences/tables/crm.contact')).toEqual(
      DEFAULT_TABLE_PREFERENCE,
    );
    expect(await tableOf(agents['pref-bob']!)).toEqual(DEFAULT_TABLE_PREFERENCE);
  });

  it('refuses tables it does not know, odd preferences and strangers', async () => {
    const ann = agents['pref-ann']!;
    await ann.get('/api/preferences/tables/nowhere').expect(400);
    await ann.put('/api/preferences/tables/nowhere').send(DEFAULT_TABLE_PREFERENCE).expect(400);
    await ann
      .put(TABLE)
      .send({ columns: { level: 'no' }, sort: null })
      .expect(400);
    await ann
      .put(TABLE)
      .send({ columns: {}, sort: { column: 'name', order: 'sideways' } })
      .expect(400);
    await ann.put(TABLE).send({ columns: {} }).expect(400);
    await request(app.getHttpServer()).get(TABLE).expect(401);
  });

  it('removes a tenant together with its preferences', async () => {
    await prisma.tenant.delete({ where: { id: tenantIds[0]! } });
    expect(await prisma.userPreference.count({ where: { tenantId: tenantIds[0]! } })).toBe(0);
  });
});
