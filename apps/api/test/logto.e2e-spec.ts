import {
  logtoSettingsViewSchema,
  logtoSignInErrors,
  meSchema,
  signInOptionsSchema,
  type LogtoSignInError,
} from '@fld/shared';
import type { INestApplication } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { SnowflakeService } from '../src/snowflake/snowflake.service.js';
import { seedTenant } from '../src/tenants/tenant-seed.js';
import { createTestApp } from './app.js';
import { FakeLogto, type LogtoUser } from './fake-logto.js';

type TestAgent = ReturnType<typeof request.agent>;

const PASSWORD = 'logto-test-password';
const SYSTEM_TENANT = 1n;
const CALLBACK_URL = 'http://crm.fld.test/api/auth/oidc/logto/callback';
/** What the platform settings call the product here, as the refusals have to. */
const APP_NAME = '星河后台';
const SIGN_IN_ERRORS = logtoSignInErrors(APP_NAME);
const ANN: LogtoUser = {
  sub: 'logto-user-ann',
  email: 'Logto-Ann@fld.test',
  email_verified: true,
  name: 'Ann',
};

// Signing in with Logto, against a stand-in for it, in order: each test builds on the state the
// previous ones left. It runs on a tenant and accounts of its own (all named logto-*), which it
// removes afterwards with the settings it saved.
describe('Signing in with Logto (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: RedisService;
  let acmeId: bigint;
  let admin: TestAgent;
  const logto = new FakeLogto();
  /** Ids of the accounts, by username. */
  const ids: Record<string, string> = {};

  const browser = () => request.agent(app.getHttpServer());
  const signIn = async (account: string) => {
    const agent = browser();
    await agent.post('/api/auth/sign-in').send({ account, password: PASSWORD }).expect(200);
    return agent;
  };
  const me = async (agent: TestAgent) =>
    meSchema.parse((await agent.get('/api/me').expect(200)).body);
  const offersLogto = async () =>
    signInOptionsSchema.parse((await browser().get('/api/auth/sign-in-options').expect(200)).body)
      .logto;
  const settings = async () =>
    logtoSettingsViewSchema.parse((await admin.get('/api/system/settings/logto').expect(200)).body);
  const save = (input: object) => admin.put('/api/system/settings/logto').send(input);
  const useLogto = (from: FakeLogto) =>
    save({ enabled: true, url: from.url, appId: from.app.id, appSecret: from.app.secret }).expect(
      200,
    );

  /** Signs in as the Logto user in a browser of its own: the browser, and where it ended up. */
  const signInWithLogto = async (
    user: LogtoUser,
    { from = logto, redirect }: { from?: FakeLogto; redirect?: string } = {},
  ) => {
    const agent = browser();
    const login = await agent
      .get('/api/auth/oidc/logto/login')
      .query(redirect ? { redirect } : {})
      .expect(302);
    const back = from.approve(String(login.headers['location']), user);
    const callback = await agent.get('/api/auth/oidc/logto/callback').query(back).expect(302);
    return { agent, location: callback.headers['location'] };
  };
  const lastAttempt = () =>
    prisma.auditLog.findFirstOrThrow({
      where: { action: 'auth.sign-in-logto' },
      orderBy: { id: 'desc' },
    });
  const identitiesOf = (username: string) =>
    prisma.userIdentity.findMany({
      where: { userId: BigInt(ids[username]!) },
      orderBy: { id: 'asc' },
    });

  beforeAll(async () => {
    await logto.start();
    app = await createTestApp();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    const snowflake = app.get(SnowflakeService);
    const nextId = () => snowflake.next();
    const passwordHash = await new PasswordHasher().hash(PASSWORD);
    const accounts = [
      { username: 'logto-admin', displayName: '平台管理员' },
      { username: 'logto-ann', displayName: '安', email: 'logto-ann@fld.test' },
      {
        username: 'logto-cat',
        displayName: '凯特',
        email: 'logto-cat@fld.test',
        status: 'DISABLED',
      },
      {
        username: 'logto-dan',
        displayName: '丹',
        email: 'logto-dan@fld.test',
        lockedAt: new Date(),
      },
      // Still on the initial password.
      {
        username: 'logto-eve',
        displayName: '伊芙',
        email: 'logto-eve@fld.test',
        mustChangePassword: true,
      },
    ] as const;
    for (const account of accounts) {
      const user = await prisma.user.create({ data: { id: nextId(), ...account, passwordHash } });
      ids[account.username] = user.id.toString();
    }
    acmeId = nextId();
    const superAdminRole = await prisma.role.findFirstOrThrow({
      where: { tenantId: SYSTEM_TENANT, builtin: true },
    });
    await prisma.$transaction(async (tx) => {
      const memberId = nextId();
      await tx.tenantMember.create({
        data: { id: memberId, tenantId: SYSTEM_TENANT, userId: BigInt(ids['logto-admin']!) },
      });
      await tx.memberRole.create({
        data: { tenantId: SYSTEM_TENANT, memberId, roleId: superAdminRole.id },
      });
      await seedTenant(tx, nextId, {
        id: acmeId,
        code: 'logto-acme',
        name: 'Logto Acme',
        adminRole: { code: 'tenant_admin', name: '租户管理员' },
        adminUserId: BigInt(ids['logto-eve']!),
      });
      await tx.tenantMember.create({
        data: { id: nextId(), tenantId: acmeId, userId: BigInt(ids['logto-ann']!) },
      });
    });
    admin = await signIn('logto-admin');
    await prisma.platformSetting.create({ data: { key: 'site.name', value: APP_NAME } });
  });

  beforeEach(async () => {
    const keys = await redis.keys('fld:throttle:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  afterAll(async () => {
    const users = Object.values(ids);
    const userIds = users.map((id) => BigInt(id));
    await prisma.session.deleteMany({ where: { userId: { in: users } } });
    await prisma.platformSetting.deleteMany({
      where: { OR: [{ key: { startsWith: 'logto.' } }, { key: 'site.name' }] },
    });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ action: 'auth.sign-in-logto' }, { actorId: { in: userIds } }] },
    });
    await prisma.tenant.deleteMany({ where: { id: acmeId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    const keys = await redis.keys('fld:oidc-state:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    await app.close();
    await logto.stop();
  });

  it("is offered once it is on and has Logto's address, an application and its secret", async () => {
    expect(await offersLogto()).toBe(false);
    expect(await settings()).toEqual({
      enabled: true,
      page: { url: null, appId: null, appSecret: false },
      env: { url: null, appId: null, appSecret: false },
      callbackUrl: CALLBACK_URL,
      ready: false,
      canStoreSecrets: true,
    });
    const off = await browser().get('/api/auth/oidc/logto/login').expect(302);
    expect(off.headers['location']).toBe('/login?error=off');

    // Plain http only reaches a Logto on this machine.
    await save({ enabled: true, url: 'http://logto.fld.test', appId: logto.app.id }).expect(400);
    const saved = await save({
      enabled: true,
      url: `${logto.url}/`,
      appId: ` ${logto.app.id} `,
      appSecret: logto.app.secret,
    }).expect(200);
    expect(logtoSettingsViewSchema.parse(saved.body)).toMatchObject({
      page: { url: logto.url, appId: logto.app.id, appSecret: true },
      ready: true,
    });
    expect(await offersLogto()).toBe(true);

    // The secret is stored encrypted, and the audit log says no more than that it changed.
    const stored = await prisma.platformSetting.findUniqueOrThrow({
      where: { key: 'logto.app-secret' },
    });
    expect(stored.value).not.toContain(logto.app.secret);
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'settings.update', targetName: 'Logto 登录' },
      orderBy: { id: 'desc' },
    });
    expect(log.changes).toEqual([
      { field: 'Logto 地址', from: null, to: logto.url },
      { field: '应用 ID', from: null, to: logto.app.id },
      { field: '应用密钥', from: null, to: '已更换' },
    ]);

    // Saving without a secret keeps the one saved.
    await save({ enabled: false, url: logto.url, appId: logto.app.id }).expect(200);
    expect(await settings()).toMatchObject({
      enabled: false,
      page: { appSecret: true },
      ready: false,
    });
    expect(await offersLogto()).toBe(false);
    await save({ enabled: true, url: logto.url, appId: logto.app.id }).expect(200);
    expect(await offersLogto()).toBe(true);
  });

  it('keeps its settings to the platform', async () => {
    const ann = await signIn('logto-ann');
    await ann.get('/api/system/settings/logto').expect(403);
    await ann
      .put('/api/system/settings/logto')
      .send({ enabled: false, url: null, appId: null })
      .expect(403);
    expect(await offersLogto()).toBe(true);
  });

  it('sends the browser to Logto, to come back to the callback', async () => {
    const login = await browser().get('/api/auth/oidc/logto/login').expect(302);
    const asked = new URL(String(login.headers['location']));
    expect(`${asked.origin}${asked.pathname}`).toBe(`${logto.issuer}/auth`);
    expect(Object.fromEntries(asked.searchParams)).toMatchObject({
      client_id: logto.app.id,
      redirect_uri: CALLBACK_URL,
      response_type: 'code',
      code_challenge_method: 'S256',
    });
    expect(asked.searchParams.get('scope')?.split(' ')).toEqual(
      expect.arrayContaining(['openid', 'email', 'profile']),
    );
  });

  it('signs in the account with the address Logto verified, then knows the Logto user', async () => {
    const { agent, location } = await signInWithLogto(ANN, { redirect: '/files' });
    expect(location).toBe('/files');
    expect(await me(agent)).toMatchObject({
      user: { username: 'logto-ann' },
      tenant: { name: 'Logto Acme' },
    });
    expect(await identitiesOf('logto-ann')).toMatchObject([
      { subject: ANN.sub, email: 'logto-ann@fld.test' },
    ]);
    const account = await prisma.user.findUniqueOrThrow({
      where: { id: BigInt(ids['logto-ann']!) },
    });
    expect(account.lastSignInAt).not.toBeNull();
    expect(await lastAttempt()).toMatchObject({
      success: true,
      accountId: BigInt(ids['logto-ann']!),
      actorUsername: 'logto-ann',
    });

    // From then on she is the Logto user, whatever her address there becomes. Only a path of
    // the site is somewhere to go afterwards.
    const moved = await signInWithLogto(
      { ...ANN, email: 'ann@elsewhere.test' },
      { redirect: 'https://elsewhere.test/' },
    );
    expect(moved.location).toBe('/');
    expect(await me(moved.agent)).toMatchObject({ user: { username: 'logto-ann' } });
    expect(await identitiesOf('logto-ann')).toHaveLength(1);
  });

  it('refuses whoever has no account, no verified address, or an account that is off or locked', async () => {
    const refuses = async (user: LogtoUser, error: LogtoSignInError, actorUsername: string) => {
      const { agent, location } = await signInWithLogto(user);
      expect(location).toBe(`/login?error=${error}`);
      await agent.get('/api/me').expect(401);
      expect(await lastAttempt()).toMatchObject({
        success: false,
        reason: SIGN_IN_ERRORS[error],
        actorUsername,
      });
    };
    await refuses(
      { sub: 'logto-user-zoe', email: 'logto-zoe@fld.test', email_verified: true },
      'no-account',
      'logto-zoe@fld.test',
    );
    // An address Logto didn't verify is anyone's to claim.
    await refuses(
      { sub: 'logto-user-mal', email: 'logto-eve@fld.test', email_verified: false },
      'no-email',
      'logto-eve@fld.test',
    );
    await refuses({ sub: 'logto-user-nil' }, 'no-email', 'logto-user-nil');
    // Ann's account is another Logto user's already.
    await refuses(
      { sub: 'logto-user-ann-2', email: 'logto-ann@fld.test', email_verified: true },
      'linked',
      'logto-ann@fld.test',
    );
    await refuses(
      { sub: 'logto-user-cat', email: 'logto-cat@fld.test', email_verified: true },
      'disabled',
      'logto-cat',
    );
    await refuses(
      { sub: 'logto-user-dan', email: 'logto-dan@fld.test', email_verified: true },
      'locked',
      'logto-dan',
    );
    // Nobody refused was linked to an account.
    expect(await prisma.userIdentity.count({ where: { subject: { not: ANN.sub } } })).toBe(0);
  });

  it("doesn't have whoever came through Logto replace an initial password", async () => {
    const withPassword = await signIn('logto-eve');
    expect((await me(withPassword)).user.mustChangePassword).toBe(true);
    await withPassword.get('/api/files/recent').expect(403);

    const { agent } = await signInWithLogto({
      sub: 'logto-user-eve',
      email: 'logto-eve@fld.test',
      email_verified: true,
    });
    expect((await me(agent)).user.mustChangePassword).toBe(false);
    await agent.get('/api/files/recent').expect(200);

    // The password is the initial one still, for whoever signs in with it.
    expect((await me(await signIn('logto-eve'))).user.mustChangePassword).toBe(true);
  });

  it('finishes a sign-in once, and only in the browser that began it', async () => {
    const agent = browser();
    const login = await agent.get('/api/auth/oidc/logto/login').expect(302);
    const back = logto.approve(String(login.headers['location']), ANN);

    const elsewhere = browser();
    const stolen = await elsewhere.get('/api/auth/oidc/logto/callback').query(back).expect(302);
    expect(stolen.headers['location']).toBe('/login?error=failed');
    await elsewhere.get('/api/me').expect(401);
    expect(await lastAttempt()).toMatchObject({
      success: false,
      reason: SIGN_IN_ERRORS.failed,
      actorUsername: null,
    });

    const first = await agent.get('/api/auth/oidc/logto/callback').query(back).expect(302);
    expect(first.headers['location']).toBe('/');
    const again = await agent.get('/api/auth/oidc/logto/callback').query(back).expect(302);
    expect(again.headers['location']).toBe('/login?error=failed');
  });

  it("doesn't take the users of another Logto for the ones it knows", async () => {
    const other = new FakeLogto();
    await other.start();
    try {
      await useLogto(other);
      // Ann's user ID is someone else's there.
      const stranger = await signInWithLogto(
        { sub: ANN.sub, email: 'logto-zoe@fld.test', email_verified: true },
        { from: other },
      );
      expect(stranger.location).toBe('/login?error=no-account');
      // Ann herself has another one there, and is found by her address once more.
      const ann = await signInWithLogto(
        { sub: 'other-user-ann', email: 'logto-ann@fld.test', email_verified: true },
        { from: other },
      );
      expect(await me(ann.agent)).toMatchObject({ user: { username: 'logto-ann' } });
      expect(await identitiesOf('logto-ann')).toHaveLength(2);
    } finally {
      await other.stop();
    }

    // Back with the first Logto, its users are who they were.
    await useLogto(logto);
    const back = await signInWithLogto({ sub: ANN.sub });
    expect(await me(back.agent)).toMatchObject({ user: { username: 'logto-ann' } });
  });

  it("says so when Logto can't be reached", async () => {
    const gone = new FakeLogto();
    await gone.start();
    await gone.stop();
    await useLogto(gone);
    const login = await browser().get('/api/auth/oidc/logto/login').expect(302);
    expect(login.headers['location']).toBe('/login?error=unavailable');
  });
});
