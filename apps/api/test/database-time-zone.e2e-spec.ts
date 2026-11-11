import { Test, type TestingModule } from '@nestjs/testing';
import pg from 'pg';
import { AppConfigModule } from '../src/config/app-config.module.js';
import { PrismaModule } from '../src/prisma/prisma.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TEST_DATABASE } from './test-env.js';

const TENANT = 9_200_000_001n;
/** Half past eight in the morning in Shanghai. */
const MOMENT = new Date('2026-11-11T00:30:00.000Z');

/** Runs a statement on a connection of its own, as an administrator would from psql. */
async function administer(statement: string): Promise<void> {
  const client = new pg.Client({ connectionString: process.env['DATABASE_URL'] });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

describe('Database time zone (e2e)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  beforeAll(async () => {
    // What every new session gets from a database, or a server, set to local time.
    await administer(`ALTER DATABASE ${TEST_DATABASE} SET timezone TO 'Asia/Shanghai'`);
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, PrismaModule],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await prisma.tenant.create({ data: { id: TENANT, code: 'time-zone', name: 'Time zone' } });
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { id: TENANT } });
    await moduleRef.close();
    await administer(`ALTER DATABASE ${TEST_DATABASE} RESET timezone`);
  });

  it('stores a time as the moment it is', async () => {
    await prisma.tenant.update({ where: { id: TENANT }, data: { createdAt: MOMENT } });

    const [stored] = await prisma.$queryRaw<[{ exact: boolean }]>`
      SELECT created_at = '2026-11-11 00:30:00+00'::timestamptz AS exact
      FROM tenants WHERE id = ${TENANT}`;
    expect(stored.exact).toBe(true);
  });

  it('reads a time as the moment it is', async () => {
    await prisma.$executeRaw`
      UPDATE tenants SET created_at = '2026-11-11 00:30:00+00'::timestamptz
      WHERE id = ${TENANT}`;

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: TENANT } });
    expect(tenant.createdAt).toEqual(MOMENT);
  });
});
