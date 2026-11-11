import {
  APP_NAME,
  auditLogPageSchema,
  confirmEmailResultSchema,
  meSchema,
  updateProfileResultSchema,
  type AuditLog,
} from '@fld/shared';
import type { INestApplication } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { EMAIL_CHANGE_ATTEMPTS } from '../src/auth/profile.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import {
  MailTransport,
  type MailMessage,
  type SmtpServer,
} from '../src/settings/mail.transport.js';
import { PlatformSettingsService } from '../src/settings/platform-settings.service.js';
import { SnowflakeService } from '../src/snowflake/snowflake.service.js';
import { seedTenant } from '../src/tenants/tenant-seed.js';
import { createTestApp } from './app.js';
import { FakeLogto, type LogtoUser } from './fake-logto.js';

type TestAgent = ReturnType<typeof request.agent>;

const PASSWORD = 'prof-test-password';
const WRONG_PASSWORD = 'prof-wrong-password';
const NEW_PASSWORD = 'prof-new-password';
const SYSTEM_TENANT = 1n;
const CONFIRM_LINK = /http:\/\/crm\.fld\.test\/confirm-email\?token=([\w-]+)/;
const RESET_LINK = /http:\/\/crm\.fld\.test\/reset-password\?token=([\w-]+)/;
const VOID_LINK = '链接无效或已过期，请回到个人资料重新修改邮箱';

/** Keeps the mail instead of sending it, unless told to fail. */
class Outbox extends MailTransport {
  readonly sent: MailMessage[] = [];
  failure: Error | null = null;

  async send(_server: SmtpServer, message: MailMessage): Promise<void> {
    if (this.failure) {
      throw this.failure;
    }
    this.sent.push(message);
  }
}

// Users changing their own name and email, in order: each test builds on the state the previous
// ones left. It runs on a tenant and accounts of its own (all named prof-*), which it removes
// afterwards with the settings it saved.
describe('Own profile (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: RedisService;
  let acmeId: bigint;
  let admin: TestAgent;
  let boss: TestAgent;
  let ann: TestAgent;
  let bob: TestAgent;
  const outbox = new Outbox();
  const logto = new FakeLogto();
  /** Ids of the accounts, by username. */
  const ids: Record<string, string> = {};

  const browser = () => request.agent(app.getHttpServer());
  const signIn = async (account: string, password = PASSWORD) => {
    const agent = browser();
    await agent.post('/api/auth/sign-in').send({ account, password }).expect(200);
    return agent;
  };
  const refusesSignIn = (account: string) =>
    browser().post('/api/auth/sign-in').send({ account, password: PASSWORD }).expect(401);
  const me = async (agent: TestAgent) =>
    meSchema.parse((await agent.get('/api/me').expect(200)).body);
  const save = (agent: TestAgent, input: object) => agent.put('/api/me/profile').send(input);
  const saved = async (agent: TestAgent, input: object) =>
    updateProfileResultSchema.parse((await save(agent, input).expect(200)).body);
  const confirm = (token: string) =>
    request(app.getHttpServer()).post('/api/auth/confirm-email').send({ token });
  /** What the tenant's audit log says the account did to its profile, newest first. */
  const log = async (
    username: string,
    action: 'auth.update-profile' | 'auth.request-email-change',
  ): Promise<AuditLog[]> => {
    const res = await boss.get('/api/system/audit-logs').query({ actor: username, action });
    return auditLogPageSchema.parse(res.body).items;
  };
  /** The newest mail to `to`. */
  const mailTo = (to: string): MailMessage => {
    const mail = outbox.sent.findLast((message) => message.to === to);
    if (!mail) {
      throw new Error(`No mail to ${to}`);
    }
    return mail;
  };
  const tokenIn = (mail: MailMessage, link = CONFIRM_LINK): string => {
    const match = link.exec(mail.text);
    if (!match) {
      throw new Error(`No link in: ${mail.text}`);
    }
    return match[1]!;
  };
  /** Asks for the new email as the account, with its password: the token of the link mailed. */
  const askFor = async (
    agent: TestAgent,
    displayName: string,
    email: string,
    currentPassword = PASSWORD,
  ) => {
    const result = await saved(agent, { displayName, email, currentPassword });
    expect(result.confirmationSentTo).toBe(email);
    return tokenIn(mailTo(email));
  };
  /** Has the link to set another password mailed to the account, at `to`: the link's token. */
  const forgotPassword = async (account: string, to: string) => {
    await request(app.getHttpServer())
      .post('/api/auth/forgot-password')
      .send({ account })
      .expect(202);
    return vi.waitFor(() => tokenIn(mailTo(to), RESET_LINK), { timeout: 5_000 });
  };
  const resetPassword = (token: string, newPassword: string) =>
    request(app.getHttpServer()).post('/api/auth/reset-password').send({ token, newPassword });
  /** Lets the account's next link go within the minute of the one before. */
  const aMinuteLater = (username: string) => redis.del(`fld:email-change:minute:${ids[username]}`);
  /** Signs in as the Logto user in a browser of its own: the browser, and where it ended up. */
  const signInWithLogto = async (user: LogtoUser) => {
    const agent = browser();
    const login = await agent.get('/api/auth/oidc/logto/login').expect(302);
    const back = logto.approve(String(login.headers['location']), user);
    const callback = await agent.get('/api/auth/oidc/logto/callback').query(back).expect(302);
    return { agent, location: callback.headers['location'] };
  };

  beforeAll(async () => {
    await logto.start();
    app = await createTestApp((builder) =>
      builder.overrideProvider(MailTransport).useValue(outbox),
    );
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    const snowflake = app.get(SnowflakeService);
    const nextId = () => snowflake.next();
    const passwordHash = await new PasswordHasher().hash(PASSWORD);
    const accounts = [
      { username: 'prof-admin', displayName: '平台管理员' },
      { username: 'prof-boss', displayName: 'Acme 管理员' },
      { username: 'prof-ann', displayName: '安', email: 'prof-ann@fld.test' },
      { username: 'prof-bob', displayName: '鲍勃' },
    ];
    for (const account of accounts) {
      const user = await prisma.user.create({ data: { id: nextId(), ...account, passwordHash } });
      ids[account.username] = user.id.toString();
    }
    acmeId = nextId();
    const superAdminRole = await prisma.role.findFirstOrThrow({
      where: { tenantId: SYSTEM_TENANT, builtin: true },
    });
    await prisma.$transaction(async (tx) => {
      // A platform administrator of the test's own, to turn Logto on and reset a password.
      const memberId = nextId();
      await tx.tenantMember.create({
        data: { id: memberId, tenantId: SYSTEM_TENANT, userId: BigInt(ids['prof-admin']!) },
      });
      await tx.memberRole.create({
        data: { tenantId: SYSTEM_TENANT, memberId, roleId: superAdminRole.id },
      });
      await seedTenant(tx, nextId, {
        id: acmeId,
        code: 'prof-acme',
        name: 'Prof Acme',
        adminRole: { code: 'tenant_admin', name: '租户管理员' },
        adminUserId: BigInt(ids['prof-boss']!),
      });
      for (const username of ['prof-ann', 'prof-bob']) {
        await tx.tenantMember.create({
          data: { id: nextId(), tenantId: acmeId, userId: BigInt(ids[username]!) },
        });
      }
    });
    admin = await signIn('prof-admin');
    boss = await signIn('prof-boss');
    ann = await signIn('prof-ann');
    bob = await signIn('prof-bob');
  });

  beforeEach(async () => {
    const keys = [
      ...(await redis.keys('fld:throttle:*')),
      ...(await redis.keys('fld:password-reset:*')),
      ...(await redis.keys('fld:email-change:*')),
    ];
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    outbox.failure = null;
  });

  afterAll(async () => {
    const users = Object.values(ids);
    const userIds = users.map((id) => BigInt(id));
    await prisma.session.deleteMany({ where: { userId: { in: users } } });
    await prisma.emailToken.deleteMany({ where: { userId: { in: users } } });
    await prisma.platformSetting.deleteMany({ where: { key: { startsWith: 'logto.' } } });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { action: 'auth.sign-in-logto' },
          // Links nobody knew: no account's, so the platform's.
          {
            action: { in: ['auth.update-profile', 'auth.reset-password'] },
            accountId: null,
            actorId: null,
          },
          { actorId: { in: userIds } },
          { actorUsername: { startsWith: 'prof-' } },
        ],
      },
    });
    await prisma.tenant.deleteMany({ where: { id: acmeId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    const keys = [
      ...(await redis.keys('fld:oidc-state:*')),
      ...(await redis.keys('fld:email-change:*')),
    ];
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    await app.close();
    await logto.stop();
  });

  it('lets anyone signed in change their name at once, and never their username', async () => {
    await save(browser(), { displayName: '安妮', email: 'prof-ann@fld.test' }).expect(401);

    const result = await saved(ann, {
      displayName: ' 安妮 ',
      email: 'prof-ann@fld.test',
      username: 'prof-other',
    });
    const user = { username: 'prof-ann', displayName: '安妮', email: 'prof-ann@fld.test' };
    expect(result).toMatchObject({ me: { user }, confirmationSentTo: null });
    expect((await me(ann)).user).toMatchObject(user);

    await save(ann, { displayName: '  ', email: 'prof-ann@fld.test' }).expect(400);
    await save(ann, { displayName: '安'.repeat(65), email: 'prof-ann@fld.test' }).expect(400);
    // Saving what the account already says changes nothing, and so records nothing.
    await save(ann, { displayName: '安妮', email: 'PROF-ANN@fld.test' }).expect(200);

    expect(await log('prof-ann', 'auth.update-profile')).toMatchObject([
      { success: true, changes: [{ field: '姓名', from: '安', to: '安妮' }] },
    ]);
    expect(outbox.sent).toEqual([]);
  });

  it('mails a new email a link, and makes it the account’s once the link is used', async () => {
    // With another name too: a save that fails saves nothing, the name neither.
    const input = { displayName: '小安', email: ' Prof-Anne@FLD.test ' };
    const missing = await save(ann, input).expect(400);
    expect(missing.body).toMatchObject({ message: '修改邮箱需要输入当前密码' });
    const wrong = await save(ann, { ...input, currentPassword: WRONG_PASSWORD }).expect(400);
    expect(wrong.body).toMatchObject({ message: '当前密码不正确' });
    expect(outbox.sent).toEqual([]);
    expect((await me(ann)).user.displayName).toBe('安妮');

    // The name changes at once, the email not yet.
    const result = await saved(ann, { ...input, currentPassword: PASSWORD });
    expect(result).toMatchObject({
      me: { user: { displayName: '小安', email: 'prof-ann@fld.test' } },
      confirmationSentTo: 'prof-anne@fld.test',
    });
    expect(outbox.sent).toHaveLength(1);
    const mail = mailTo('prof-anne@fld.test');
    expect(mail.subject).toBe(`确认你的 ${APP_NAME} 新邮箱`);
    expect(mail.text).toContain('小安，你好');
    expect(mail.text).toContain('如果不是你本人操作，请忽略这封邮件');
    expect(mail.text).toContain('账号 prof-ann 申请把邮箱改为 prof-anne@fld.test');
    expect(mail.text).toContain('30 分钟');
    const token = tokenIn(mail);
    // Kept as a hash, for half an hour.
    const kept = await prisma.emailToken.findFirstOrThrow({
      where: { userId: ids['prof-ann']!, purpose: 'email-verification' },
    });
    expect(kept.id).not.toBe(token);
    expect(kept.expiresAt.getTime() - kept.createdAt.getTime()).toBe(30 * 60_000);
    expect(mail.html).toContain(`<a href="http://crm.fld.test/confirm-email?token=${token}"`);

    // Until the link is used, the account keeps the address it had.
    expect((await me(ann)).user).toMatchObject({ displayName: '小安', email: 'prof-ann@fld.test' });
    await refusesSignIn('prof-anne@fld.test');

    // Whoever holds the link confirms it, signed in or not.
    const confirmed = await confirm(token).expect(200);
    expect(confirmEmailResultSchema.parse(confirmed.body)).toEqual({
      email: 'prof-anne@fld.test',
    });
    expect((await me(ann)).user.email).toBe('prof-anne@fld.test');
    await signIn('prof-anne@fld.test');
    await refusesSignIn('prof-ann@fld.test');
    // It works once.
    expect((await confirm(token).expect(400)).body).toMatchObject({ message: VOID_LINK });
    await confirm('no-such-token').expect(400);

    const change = { field: '邮箱', from: 'prof-ann@fld.test', to: 'prof-anne@fld.test' };
    expect(await log('prof-ann', 'auth.request-email-change')).toMatchObject([
      { success: true, changes: [change] },
    ]);
    const profile = await log('prof-ann', 'auth.update-profile');
    expect(profile).toMatchObject([
      { success: true, changes: [change] },
      { success: true, changes: [{ field: '姓名', from: '安妮', to: '小安' }] },
      { success: false, reason: '当前密码不正确' },
      { success: true, changes: [{ field: '姓名', from: '安', to: '安妮' }] },
    ]);
    const rows = JSON.stringify(profile);
    for (const secret of [PASSWORD, WRONG_PASSWORD, token]) {
      expect(rows).not.toContain(secret);
    }
  });

  it('keeps an email to one account, when asked for and when confirmed', async () => {
    const taken = await save(bob, {
      displayName: '鲍勃',
      email: 'PROF-ANNE@fld.test',
      currentPassword: PASSWORD,
    }).expect(409);
    expect(taken.body).toMatchObject({ message: '邮箱已被其他账号使用' });
    expect((await log('prof-bob', 'auth.request-email-change'))[0]).toMatchObject({
      success: false,
      reason: '邮箱已被其他账号使用',
      changes: [{ field: '邮箱', from: null, to: 'prof-anne@fld.test' }],
    });
    await save(bob, {
      displayName: '鲍勃',
      email: 'not-an-address',
      currentPassword: PASSWORD,
    }).expect(400);
    expect(outbox.sent).toHaveLength(1);

    // Another account gets the address between the mail and the click.
    const token = await askFor(bob, '鲍勃', 'prof-shared@fld.test');
    const boss = { id: BigInt(ids['prof-boss']!) };
    await prisma.user.update({ where: boss, data: { email: 'prof-shared@fld.test' } });
    const late = await confirm(token).expect(409);
    expect(late.body).toMatchObject({ message: '这个邮箱已被其他账号使用，没有修改' });
    expect((await log('prof-bob', 'auth.update-profile'))[0]).toMatchObject({
      success: false,
      reason: '邮箱已被其他账号使用',
      changes: [{ field: '邮箱', from: null, to: 'prof-shared@fld.test' }],
    });
    expect((await me(bob)).user.email).toBeNull();
    await prisma.user.update({ where: boss, data: { email: null } });
    await confirm(token).expect(400);
  });

  it('lets an account go without an email at once, which voids the links mailed for it', async () => {
    await confirm(await askFor(bob, '鲍勃', 'prof-bob@fld.test')).expect(200);
    expect((await me(bob)).user.email).toBe('prof-bob@fld.test');
    const reset = await forgotPassword('prof-bob', 'prof-bob@fld.test');
    await aMinuteLater('prof-bob');
    const pending = await askFor(bob, '鲍勃', 'prof-bob-next@fld.test');
    const mails = outbox.sent.length;

    // Blank clears it, which takes the password like any other change, but no mail service.
    vi.spyOn(app.get(PlatformSettingsService), 'mailReady').mockResolvedValue(false);
    await save(bob, { displayName: '鲍勃', email: '' }).expect(400);
    const cleared = await saved(bob, {
      displayName: '鲍勃',
      email: ' ',
      currentPassword: PASSWORD,
    });
    expect(cleared).toMatchObject({ me: { user: { email: null } }, confirmationSentTo: null });
    expect((await me(bob)).user.email).toBeNull();
    expect(outbox.sent).toHaveLength(mails);
    await refusesSignIn('prof-bob@fld.test');
    // Neither the link to the address it asked for, nor the one mailed to the address it had.
    expect(await prisma.emailToken.count({ where: { userId: ids['prof-bob']! } })).toBe(0);
    await confirm(pending).expect(400);
    await resetPassword(reset, NEW_PASSWORD).expect(400);
    expect((await me(bob)).user.email).toBeNull();

    expect((await log('prof-bob', 'auth.update-profile'))[0]).toMatchObject({
      success: true,
      changes: [{ field: '邮箱', from: 'prof-bob@fld.test', to: null }],
    });
  });

  it('changes no email without a mail service, or when the mail does not go', async () => {
    const input = { displayName: '鲍勃', email: 'prof-bob@fld.test', currentPassword: PASSWORD };
    const mails = outbox.sent.length;
    const ready = vi.spyOn(app.get(PlatformSettingsService), 'mailReady').mockResolvedValue(false);
    const refused = await save(bob, input).expect(503);
    expect(refused.body).toMatchObject({
      message: '还没有配置邮件服务，暂时不能修改邮箱，请联系管理员',
    });
    // The name needs no mail.
    const renamed = await saved(bob, { displayName: '鲍勃二世', email: null });
    expect(renamed.me.user.displayName).toBe('鲍勃二世');
    ready.mockRestore();

    // The mail server refuses: nothing is saved, the name neither.
    outbox.failure = new Error('550 mailbox unavailable');
    const failed = await save(bob, input).expect(502);
    expect(failed.body).toMatchObject({
      message: '确认邮件没有发出去，请稍后再试，或联系管理员检查邮件服务',
    });
    expect((await me(bob)).user).toMatchObject({ displayName: '鲍勃二世', email: null });
    expect(outbox.sent).toHaveLength(mails);
    expect((await log('prof-bob', 'auth.request-email-change'))[0]).toMatchObject({
      success: false,
      reason: '确认邮件没有发出去',
      changes: [{ field: '邮箱', from: null, to: 'prof-bob@fld.test' }],
    });
  });

  it('makes an account that keeps getting the password wrong wait, to change the email only', async () => {
    const attempts = `fld:email-change:attempts:${ids['prof-bob']}`;
    const ask = (currentPassword: string) =>
      save(bob, { displayName: '鲍勃', email: 'prof-bob@fld.test', currentPassword });
    for (let attempt = 0; attempt < EMAIL_CHANGE_ATTEMPTS; attempt += 1) {
      await ask(WRONG_PASSWORD).expect(400);
    }
    // Not even the right one gets through now.
    const mails = outbox.sent.length;
    const locked = await ask(PASSWORD).expect(429);
    expect(locked.body).toMatchObject({ message: '当前密码输错的次数太多，请 15 分钟后再试' });
    expect(outbox.sent).toHaveLength(mails);
    expect((await log('prof-bob', 'auth.update-profile'))[0]).toMatchObject({
      success: false,
      reason: '当前密码输错的次数太多',
    });
    // The wait ends by itself, a quarter of an hour after the first wrong one.
    const wait = await redis.ttl(attempts);
    expect(wait).toBeGreaterThan(14 * 60);
    expect(wait).toBeLessThanOrEqual(15 * 60);

    // The name takes no password, so it doesn't wait.
    const renamed = await saved(bob, { displayName: '鲍勃三世', email: null });
    expect(renamed.me.user.displayName).toBe('鲍勃三世');

    await redis.del(attempts);
    await ask(WRONG_PASSWORD).expect(400);
    await ask(PASSWORD).expect(200);
    expect(outbox.sent).toHaveLength(mails + 1);
    // The right password starts the count anew.
    expect(await redis.exists(attempts)).toBe(0);
  });

  it('mails an account one link a minute and five an hour, the newest one working', async () => {
    const first = await askFor(bob, '鲍勃', 'prof-bob-1@fld.test');
    const mails = outbox.sent.length;
    const ask = (email: string) =>
      save(bob, { displayName: '鲍勃', email, currentPassword: PASSWORD });
    const soon = await ask('prof-bob-2@fld.test').expect(429);
    expect(soon.body).toMatchObject({ message: '确认邮件发得太频繁，请稍后再试' });
    expect(outbox.sent).toHaveLength(mails);

    await aMinuteLater('prof-bob');
    const second = await askFor(bob, '鲍勃', 'prof-bob-2@fld.test');
    await confirm(first).expect(400);
    await confirm(second).expect(200);
    expect((await me(bob)).user.email).toBe('prof-bob-2@fld.test');

    // Each mail counts towards the hour's five, a refusal doesn't.
    const hour = `fld:email-change:hour:${ids['prof-bob']}`;
    expect(await redis.get(hour)).toBe('2');
    await aMinuteLater('prof-bob');
    await redis.set(hour, '5', 'EX', 3600);
    await ask('prof-bob-3@fld.test').expect(429);
    expect(outbox.sent).toHaveLength(mails + 1);

    // Newest first: what was mailed, and what wasn't.
    const tooOften = { success: false, reason: '申请太频繁，没有发送邮件' };
    const asked = await log('prof-bob', 'auth.request-email-change');
    expect(asked.slice(0, 4)).toMatchObject([
      {
        ...tooOften,
        changes: [{ field: '邮箱', from: 'prof-bob-2@fld.test', to: 'prof-bob-3@fld.test' }],
      },
      { success: true, changes: [{ field: '邮箱', from: null, to: 'prof-bob-2@fld.test' }] },
      { ...tooOften, changes: [{ field: '邮箱', from: null, to: 'prof-bob-2@fld.test' }] },
      { success: true, changes: [{ field: '邮箱', from: null, to: 'prof-bob-1@fld.test' }] },
    ]);
  });

  it('voids a link after half an hour, and once the password changed or the account is disabled', async () => {
    const user = { id: BigInt(ids['prof-bob']!) };
    let password = PASSWORD;
    const ask = async () => {
      await aMinuteLater('prof-bob');
      await redis.del(`fld:email-change:hour:${ids['prof-bob']}`);
      return askFor(bob, '鲍勃', 'prof-bob-late@fld.test', password);
    };
    const refusals = async () =>
      (await log('prof-bob', 'auth.update-profile')).filter(
        (entry) => entry.reason === '确认链接无效或已过期',
      ).length;
    expect(await refusals()).toBe(0);

    const late = await ask();
    await prisma.emailToken.updateMany({
      where: { userId: ids['prof-bob']!, purpose: 'email-verification' },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    expect((await confirm(late).expect(400)).body).toMatchObject({ message: VOID_LINK });
    // The tenant sees whose link it was.
    expect(await refusals()).toBe(1);

    const disabled = await ask();
    await prisma.user.update({ where: user, data: { status: 'DISABLED' } });
    await confirm(disabled).expect(400);
    await prisma.user.update({ where: user, data: { status: 'ACTIVE' } });
    bob = await signIn('prof-bob');

    // However the password changed. The account changed it itself:
    const own = await ask();
    await bob
      .put('/api/me/password')
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(200);
    password = NEW_PASSWORD;
    await confirm(own).expect(400);

    // it forgot it, and set another with the link mailed to it:
    const forgotten = await ask();
    const resetLink = await forgotPassword('prof-bob', 'prof-bob-2@fld.test');
    password = 'prof-mailed-password';
    await resetPassword(resetLink, password).expect(204);
    await confirm(forgotten).expect(400);
    bob = await signIn('prof-bob', password);

    // or an administrator reset it.
    const reset = await ask();
    await admin.post(`/api/system/accounts/${ids['prof-bob']}/reset-password`).expect(200);
    await confirm(reset).expect(400);

    expect(await refusals()).toBe(5);
    expect(await prisma.user.findUniqueOrThrow({ where: user })).toMatchObject({
      email: 'prof-bob-2@fld.test',
    });
  });

  it('voids the password reset links mailed to the address the account had', async () => {
    const reset = await forgotPassword('prof-ann', 'prof-anne@fld.test');
    const resetLinks = () =>
      prisma.emailToken.count({ where: { userId: ids['prof-ann']!, purpose: 'password-reset' } });
    expect(await resetLinks()).toBe(1);

    await confirm(await askFor(ann, '小安', 'prof-ann@fld.test')).expect(200);
    expect(await resetLinks()).toBe(0);
    // Not even once the account has the address again.
    await aMinuteLater('prof-ann');
    await confirm(await askFor(ann, '小安', 'prof-anne@fld.test')).expect(200);
    const res = await resetPassword(reset, NEW_PASSWORD).expect(400);
    expect(res.body).toMatchObject({ message: '链接无效或已过期，请重新申请' });
    await signIn('prof-ann');
  });

  it('keeps the link to a Logto account, and lets Logto find the account by its new email', async () => {
    await admin
      .put('/api/system/settings/logto')
      .send({ enabled: true, url: logto.url, appId: logto.app.id, appSecret: logto.app.secret })
      .expect(200);
    const logtoAnn: LogtoUser = {
      sub: 'prof-logto-ann',
      email: 'prof-anne@fld.test',
      email_verified: true,
      name: 'Ann',
    };
    expect((await signInWithLogto(logtoAnn)).location).toBe('/');
    // Linked once, the Logto account stays the CRM account's whatever its email becomes.
    await aMinuteLater('prof-ann');
    await confirm(await askFor(ann, '小安', 'prof-ann-moved@fld.test')).expect(200);
    const again = await signInWithLogto(logtoAnn);
    expect(again.location).toBe('/');
    expect((await me(again.agent)).user).toMatchObject({
      username: 'prof-ann',
      email: 'prof-ann-moved@fld.test',
    });

    // An account Logto couldn't find is found once the email Logto knows is confirmed as its own.
    const logtoBoss: LogtoUser = {
      sub: 'prof-logto-boss',
      email: 'prof-boss-work@fld.test',
      email_verified: true,
      name: 'Boss',
    };
    expect((await signInWithLogto(logtoBoss)).location).toBe('/login?error=no-account');
    const token = await askFor(boss, 'Acme 管理员', 'prof-boss-work@fld.test');
    expect((await signInWithLogto(logtoBoss)).location).toBe('/login?error=no-account');
    await confirm(token).expect(200);
    const found = await signInWithLogto(logtoBoss);
    expect(found.location).toBe('/');
    expect((await me(found.agent)).user.username).toBe('prof-boss');
  });

  it('mails the confirmation as the platform’s template for it says, edited or built in', async () => {
    const ask = () => askFor(boss, 'Acme 管理员', 'prof-boss-home@fld.test');
    await admin
      .put('/api/system/mail-templates/email-change')
      .send({
        subject: '{{用户名}} 的新邮箱',
        body: '{{姓名}}：{{新邮箱}}\n{{确认链接}}\n{{有效分钟}} 分钟',
      })
      .expect(200);
    const token = await ask();
    expect(mailTo('prof-boss-home@fld.test')).toMatchObject({
      subject: 'prof-boss 的新邮箱',
      text: `Acme 管理员：prof-boss-home@fld.test\nhttp://crm.fld.test/confirm-email?token=${token}\n30 分钟`,
    });

    await admin.delete('/api/system/mail-templates/email-change').expect(200);
    await aMinuteLater('prof-boss');
    await ask();
    expect(mailTo('prof-boss-home@fld.test').subject).toBe(`确认你的 ${APP_NAME} 新邮箱`);
  });
});
