import { Test, type TestingModule } from '@nestjs/testing';
import { tenantScope } from '../src/authz/tenant-prisma.js';
import { AppConfigModule } from '../src/config/app-config.module.js';
import { PrismaModule } from '../src/prisma/prisma.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const OURS = 9_100_000_001n;
const THEIRS = 9_100_000_002n;
const OUR_SALES = 9_100_000_101n;
const OUR_SUPPORT = 9_100_000_102n;
const PLANTED = 9_100_000_103n;
const THEIR_SALES = 9_100_000_201n;

describe('Tenant-scoped Prisma client (e2e)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let currentTenant = OURS;
  const scoped = () => prisma.$extends(tenantScope(() => currentTenant));

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, PrismaModule],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await prisma.tenant.createMany({
      data: [
        { id: OURS, code: 'scope-ours', name: 'Ours' },
        { id: THEIRS, code: 'scope-theirs', name: 'Theirs' },
      ],
    });
    await prisma.department.createMany({
      data: [
        { id: OUR_SALES, tenantId: OURS, name: 'Our sales', path: `/${OUR_SALES}/` },
        { id: THEIR_SALES, tenantId: THEIRS, name: 'Their sales', path: `/${THEIR_SALES}/` },
      ],
    });
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { id: { in: [OURS, THEIRS] } } });
    await moduleRef.close();
  });

  it("reads only the current tenant's rows", async () => {
    const db = scoped();
    const names = (await db.department.findMany()).map((dept) => dept.name);
    expect(names).toEqual(['Our sales']);
    expect(await db.department.findUnique({ where: { id: THEIR_SALES } })).toBeNull();
    expect(await db.department.count({ where: { tenantId: THEIRS } })).toBe(1);
  });

  it("can't change or delete another tenant's rows", async () => {
    const db = scoped();
    await expect(
      db.department.update({ where: { id: THEIR_SALES }, data: { name: 'Hijacked' } }),
    ).rejects.toThrow();
    expect((await db.department.deleteMany({ where: { id: THEIR_SALES } })).count).toBe(0);
    const theirs = await prisma.department.findUniqueOrThrow({ where: { id: THEIR_SALES } });
    expect(theirs.name).toBe('Their sales');
  });

  it('creates rows only in the current tenant, which follows the caller', async () => {
    const db = scoped();
    const created = await db.department.create({
      data: { id: OUR_SUPPORT, tenantId: OURS, name: 'Our support', path: `/${OUR_SUPPORT}/` },
    });
    expect(created.tenantId).toBe(OURS);
    await expect(
      db.department.create({
        data: { id: PLANTED, tenantId: THEIRS, name: 'Planted', path: `/${PLANTED}/` },
      }),
    ).rejects.toThrow('only be created in the current tenant');

    currentTenant = THEIRS;
    expect((await db.department.findMany()).map((dept) => dept.name)).toEqual(['Their sales']);
    currentTenant = OURS;
  });
});
