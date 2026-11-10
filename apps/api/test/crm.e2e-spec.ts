import {
  contactSchema,
  customerSchema,
  followUpSchema,
  opportunityPageSchema,
  opportunitySchema,
  ownerOptionSchema,
  pageSchema,
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

const PASSWORD = 'crm-test-password';
const DAY = 86_400_000;
const USERNAMES = ['crm-admin', 'crm-manager', 'crm-east', 'crm-west', 'crm-helper'];
const customerPageSchema = pageSchema(customerSchema);
const contactPageSchema = pageSchema(contactSchema);
const followUpPageSchema = pageSchema(followUpSchema);

const SALES_PERMISSIONS: PermissionCode[] = [
  'crm:customer',
  'crm:customer:create',
  'crm:customer:update',
  'crm:contact',
  'crm:contact:create',
  'crm:contact:update',
  'crm:follow-up',
  'crm:follow-up:create',
  'crm:opportunity',
  'crm:opportunity:create',
  'crm:opportunity:update',
];
const MANAGER_PERMISSIONS: PermissionCode[] = [
  ...SALES_PERMISSIONS,
  'crm:customer:transfer',
  'crm:customer:delete',
  'crm:contact:delete',
  'crm:follow-up:delete',
  'crm:opportunity:transfer',
  'crm:opportunity:delete',
];

// One story, in order: each test builds on the state the previous ones left. In tenant Acme a sales
// manager whose data scope is the Sales department and below leads two salespeople, in East and
// West, who see only their own records; a second tenant checks isolation. Both tenants and their
// accounts (all named crm-*) are removed afterwards.
describe('CRM (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let acmeId: bigint;
  let otherId: bigint;
  const userIds: Record<string, bigint> = {};
  const agents: Record<string, TestAgent> = {};
  /** Ids of the records the story creates, by name. */
  const ids: Record<string, string> = {};

  const agent = (username: string) => agents[username]!;
  const userId = (username: string) => userIds[username]!.toString();
  const customerNames = async (as: TestAgent, query = '') =>
    customerPageSchema
      .parse((await as.get(`/api/crm/customers${query}`).expect(200)).body)
      .items.map(({ name }) => name)
      .sort();
  const getCustomer = async (as: TestAgent, name: string) =>
    customerSchema.parse((await as.get(`/api/crm/customers/${ids[name]}`).expect(200)).body);

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
        code: 'crm-acme',
        name: 'Acme',
        adminRole,
        adminUserId: userIds['crm-admin']!,
      });
      await seedTenant(tx, nextId, {
        id: otherId,
        code: 'crm-other',
        name: 'Other',
        adminRole,
        adminUserId: userIds['crm-helper']!,
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
        dataScope: 'DEPT_AND_CHILDREN' | 'SELF',
        permissions: PermissionCode[],
      ) => {
        const id = nextId();
        await tx.role.create({ data: { id, tenantId: acmeId, code, name: code, dataScope } });
        await tx.rolePermission.createMany({
          data: permissions.map((permission) => ({ roleId: id, permission })),
        });
        return id;
      };
      const managerRole = await addRole('crm-manager', 'DEPT_AND_CHILDREN', MANAGER_PERMISSIONS);
      const salesRole = await addRole('crm-sales', 'SELF', SALES_PERMISSIONS);
      const members: [string, bigint, bigint][] = [
        ['crm-manager', sales.id, managerRole],
        ['crm-east', east.id, salesRole],
        ['crm-west', west.id, salesRole],
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
      where: { username: { startsWith: 'crm-' } },
      select: { id: true },
    });
    await prisma.session.deleteMany({
      where: { userId: { in: users.map(({ id }) => id.toString()) } },
    });
    await prisma.tenant.deleteMany({ where: { id: { in: [acmeId, otherId] } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(({ id }) => id) } } });
    await app.close();
  });

  it('shows each user the customers its data scope covers', async () => {
    for (const [username, name] of [
      ['crm-east', 'East Co'],
      ['crm-west', 'West Co'],
      ['crm-manager', 'Sales Co'],
      ['crm-admin', 'HQ Co'],
    ] as const) {
      const customer = customerSchema.parse(
        (await agent(username).post('/api/crm/customers').send({ name, phone: '' }).expect(201))
          .body,
      );
      expect(customer).toMatchObject({
        owner: { displayName: username },
        creator: { displayName: username },
        level: 'B',
        status: 'POTENTIAL',
        phone: null,
      });
      ids[name] = customer.id;
    }
    expect((await getCustomer(agent('crm-admin'), 'East Co')).dept?.name).toBe('East');

    expect(await customerNames(agent('crm-east'))).toEqual(['East Co']);
    expect(await customerNames(agent('crm-west'))).toEqual(['West Co']);
    expect(await customerNames(agent('crm-manager'))).toEqual(['East Co', 'Sales Co', 'West Co']);
    expect(await customerNames(agent('crm-manager'), '?mine=true')).toEqual(['Sales Co']);
    expect(await customerNames(agent('crm-admin'))).toEqual([
      'East Co',
      'HQ Co',
      'Sales Co',
      'West Co',
    ]);

    // Out of scope reads as missing.
    await agent('crm-east').get(`/api/crm/customers/${ids['West Co']}`).expect(404);
    await agent('crm-east')
      .patch(`/api/crm/customers/${ids['West Co']}`)
      .send({ level: 'A' })
      .expect(404);
    const updated = customerSchema.parse(
      (
        await agent('crm-east')
          .patch(`/api/crm/customers/${ids['East Co']}`)
          .send({ level: 'A', industry: '制造' })
          .expect(200)
      ).body,
    );
    expect(updated).toMatchObject({ level: 'A', industry: '制造' });
  });

  it('keeps contacts and follow-ups with their customer', async () => {
    const east = agent('crm-east');
    const contactNames = async () =>
      contactPageSchema
        .parse((await east.get(`/api/crm/contacts?customerId=${ids['East Co']}`).expect(200)).body)
        .items.map(({ name, primary }) => [name, primary]);
    for (const name of ['Alice', 'Bob']) {
      const contact = contactSchema.parse(
        (
          await east
            .post('/api/crm/contacts')
            .send({ customerId: ids['East Co'], name, primary: true, email: `${name}@Example.com` })
            .expect(201)
        ).body,
      );
      expect(contact).toMatchObject({
        customer: { name: 'East Co' },
        email: `${name.toLowerCase()}@example.com`,
      });
      ids[name] = contact.id;
    }
    // A customer has one primary contact: the latest to become it.
    expect(await contactNames()).toEqual([
      ['Bob', true],
      ['Alice', false],
    ]);
    await east.patch(`/api/crm/contacts/${ids['Alice']}`).send({ primary: true }).expect(200);
    expect(await contactNames()).toEqual([
      ['Alice', true],
      ['Bob', false],
    ]);

    await east
      .post('/api/crm/contacts')
      .send({ customerId: ids['West Co'], name: 'Mallory' })
      .expect(404);
    await agent('crm-west')
      .patch(`/api/crm/contacts/${ids['Alice']}`)
      .send({ name: 'Eve' })
      .expect(404);
    const contactTotal = async (as: TestAgent) =>
      contactPageSchema.parse((await as.get('/api/crm/contacts').expect(200)).body).total;
    expect(await contactTotal(agent('crm-west'))).toBe(0);
    expect(await contactTotal(agent('crm-manager'))).toBe(2);

    // The latest follow-up sets the customer's last and next follow-up times.
    const nextAt = new Date(Date.now() + 3 * DAY).toISOString();
    const latest = followUpSchema.parse(
      (
        await east
          .post('/api/crm/follow-ups')
          .send({
            customerId: ids['East Co'],
            contactId: ids['Alice'],
            method: 'CALL',
            content: '介绍产品',
            nextAt,
          })
          .expect(201)
      ).body,
    );
    expect(latest).toMatchObject({
      contact: { name: 'Alice' },
      author: { displayName: 'crm-east' },
      nextAt,
    });
    const earlierAt = new Date(Date.now() - DAY).toISOString();
    await east
      .post('/api/crm/follow-ups')
      .send({ customerId: ids['East Co'], method: 'VISIT', content: '拜访', followedAt: earlierAt })
      .expect(201);
    expect(await getCustomer(east, 'East Co')).toMatchObject({
      lastFollowUpAt: latest.followedAt,
      nextFollowUpAt: nextAt,
    });
    const dueBy = encodeURIComponent(new Date(Date.now() + 7 * DAY).toISOString());
    expect(await customerNames(agent('crm-manager'), `?dueBy=${dueBy}`)).toEqual(['East Co']);

    // Contacts of another customer, and customers out of scope, are refused.
    await agent('crm-manager')
      .post('/api/crm/follow-ups')
      .send({
        customerId: ids['Sales Co'],
        contactId: ids['Alice'],
        method: 'CALL',
        content: '问候',
      })
      .expect(400);
    await agent('crm-west')
      .post('/api/crm/follow-ups')
      .send({ customerId: ids['East Co'], method: 'CALL', content: '问候' })
      .expect(404);
    expect(
      followUpPageSchema.parse(
        (await agent('crm-west').get('/api/crm/follow-ups').expect(200)).body,
      ).total,
    ).toBe(0);

    // Deleting the latest falls back to the one before it.
    await east.delete(`/api/crm/follow-ups/${latest.id}`).expect(403);
    await agent('crm-manager').delete(`/api/crm/follow-ups/${latest.id}`).expect(204);
    expect(await getCustomer(east, 'East Co')).toMatchObject({
      lastFollowUpAt: earlierAt,
      nextFollowUpAt: null,
    });
  });

  it('tracks opportunities through their stages', async () => {
    const east = agent('crm-east');
    for (const [name, amount, stage] of [
      ['Big deal', '1000.5', undefined],
      ['Small deal', '200', 'PROPOSAL'],
    ] as const) {
      const opportunity = opportunitySchema.parse(
        (
          await east
            .post('/api/crm/opportunities')
            .send({
              customerId: ids['East Co'],
              name,
              amount,
              stage,
              expectedCloseDate: '2026-12-31',
            })
            .expect(201)
        ).body,
      );
      expect(opportunity).toMatchObject({
        owner: { displayName: 'crm-east' },
        dept: { name: 'East' },
        expectedCloseDate: '2026-12-31',
        closedAt: null,
      });
      ids[name] = opportunity.id;
    }
    await east
      .post('/api/crm/opportunities')
      .send({ customerId: ids['East Co'], name: 'Odd', amount: '1.234' })
      .expect(400);

    // The stage filter narrows the page but not the summary.
    const page = opportunityPageSchema.parse(
      (await east.get('/api/crm/opportunities?stage=PROPOSAL').expect(200)).body,
    );
    expect(page.items.map(({ name }) => name)).toEqual(['Small deal']);
    expect(page.stages).toHaveLength(6);
    expect(page.stages.filter(({ count }) => count > 0)).toEqual([
      { stage: 'QUALIFY', count: 1, amount: '1000.50' },
      { stage: 'PROPOSAL', count: 1, amount: '200.00' },
    ]);

    // Winning closes the opportunity and wins the customer; reopening only clears the close.
    const won = opportunitySchema.parse(
      (
        await east
          .patch(`/api/crm/opportunities/${ids['Big deal']}`)
          .send({ stage: 'WON' })
          .expect(200)
      ).body,
    );
    expect(won.closedAt).not.toBeNull();
    expect((await getCustomer(east, 'East Co')).status).toBe('WON');
    const reopened = opportunitySchema.parse(
      (
        await east
          .patch(`/api/crm/opportunities/${ids['Big deal']}`)
          .send({ stage: 'NEGOTIATION', amount: '1200' })
          .expect(200)
      ).body,
    );
    expect(reopened).toMatchObject({ stage: 'NEGOTIATION', amount: '1200.00', closedAt: null });
    expect((await getCustomer(east, 'East Co')).status).toBe('WON');

    const opportunityTotal = async (as: TestAgent) =>
      opportunityPageSchema.parse((await as.get('/api/crm/opportunities').expect(200)).body).total;
    expect(await opportunityTotal(agent('crm-west'))).toBe(0);
    expect(await opportunityTotal(agent('crm-manager'))).toBe(2);
    await agent('crm-west')
      .patch(`/api/crm/opportunities/${ids['Big deal']}`)
      .send({ stage: 'LOST' })
      .expect(404);
  });

  it('hands customers and opportunities over within the data scope', async () => {
    const manager = agent('crm-manager');
    const owners = z
      .array(ownerOptionSchema)
      .parse((await manager.get('/api/crm/owners').expect(200)).body);
    expect(owners.map(({ username }) => username).sort()).toEqual([
      'crm-east',
      'crm-manager',
      'crm-west',
    ]);
    await agent('crm-east').get('/api/crm/owners').expect(403);

    const moved = customerSchema.parse(
      (
        await manager
          .post(`/api/crm/customers/${ids['East Co']}/transfer`)
          .send({ ownerId: userId('crm-west') })
          .expect(200)
      ).body,
    );
    expect(moved).toMatchObject({ owner: { displayName: 'crm-west' }, dept: { name: 'West' } });
    await agent('crm-east').get(`/api/crm/customers/${ids['East Co']}`).expect(404);
    expect(await customerNames(agent('crm-west'))).toEqual(['East Co', 'West Co']);
    // The customer's opportunities stay with their owner.
    expect(
      opportunityPageSchema.parse(
        (await agent('crm-east').get('/api/crm/opportunities').expect(200)).body,
      ).total,
    ).toBe(2);

    // Not beyond the manager's data scope, nor outside the tenant.
    await manager
      .post(`/api/crm/customers/${ids['West Co']}/transfer`)
      .send({ ownerId: userId('crm-admin') })
      .expect(403);
    await manager
      .post(`/api/crm/customers/${ids['West Co']}/transfer`)
      .send({ ownerId: userId('crm-helper') })
      .expect(400);
    await agent('crm-west')
      .post(`/api/crm/customers/${ids['West Co']}/transfer`)
      .send({ ownerId: userId('crm-east') })
      .expect(403);

    const opportunity = opportunitySchema.parse(
      (
        await manager
          .post(`/api/crm/opportunities/${ids['Small deal']}/transfer`)
          .send({ ownerId: userId('crm-west') })
          .expect(200)
      ).body,
    );
    expect(opportunity).toMatchObject({
      owner: { displayName: 'crm-west' },
      dept: { name: 'West' },
    });
  });

  it('deletes a customer only once it has no opportunities', async () => {
    const manager = agent('crm-manager');
    await agent('crm-west').delete(`/api/crm/customers/${ids['East Co']}`).expect(403);
    await manager.delete(`/api/crm/customers/${ids['East Co']}`).expect(409);
    await manager.delete(`/api/crm/opportunities/${ids['Big deal']}`).expect(204);
    await manager.delete(`/api/crm/opportunities/${ids['Small deal']}`).expect(204);
    await manager.delete(`/api/crm/customers/${ids['East Co']}`).expect(204);
    await manager.get(`/api/crm/customers/${ids['East Co']}`).expect(404);
    const customerId = BigInt(ids['East Co']!);
    expect(await prisma.contact.count({ where: { customerId } })).toBe(0);
    expect(await prisma.followUp.count({ where: { customerId } })).toBe(0);
  });

  it('keeps other tenants out', async () => {
    const helper = agent('crm-helper');
    const theirs = customerSchema.parse(
      (await helper.post('/api/crm/customers').send({ name: 'Other Co' }).expect(201)).body,
    );
    ids['Other Co'] = theirs.id;
    expect(await customerNames(helper)).toEqual(['Other Co']);

    const admin = agent('crm-admin');
    await admin.get(`/api/crm/customers/${theirs.id}`).expect(404);
    await admin.patch(`/api/crm/customers/${theirs.id}`).send({ name: 'Mine' }).expect(404);
    await admin.post('/api/crm/contacts').send({ customerId: theirs.id, name: 'Spy' }).expect(404);
    await admin
      .post('/api/crm/opportunities')
      .send({ customerId: theirs.id, name: 'Steal', amount: '1' })
      .expect(404);
    expect(await customerNames(admin)).toEqual(['HQ Co', 'Sales Co', 'West Co']);
  });

  it('removes a tenant together with its CRM data', async () => {
    const helper = agent('crm-helper');
    const customerId = ids['Other Co'];
    const contact = contactSchema.parse(
      (await helper.post('/api/crm/contacts').send({ customerId, name: 'Carol' }).expect(201)).body,
    );
    const opportunity = opportunitySchema.parse(
      (
        await helper
          .post('/api/crm/opportunities')
          .send({ customerId, name: 'Deal', amount: '10' })
          .expect(201)
      ).body,
    );
    await helper
      .post('/api/crm/follow-ups')
      .send({
        customerId,
        contactId: contact.id,
        opportunityId: opportunity.id,
        method: 'MEETING',
        content: '签约',
      })
      .expect(201);

    await prisma.tenant.delete({ where: { id: otherId } });
    const where = { tenantId: otherId };
    expect(await prisma.customer.count({ where })).toBe(0);
    expect(await prisma.contact.count({ where })).toBe(0);
    expect(await prisma.followUp.count({ where })).toBe(0);
    expect(await prisma.opportunity.count({ where })).toBe(0);
  });
});
