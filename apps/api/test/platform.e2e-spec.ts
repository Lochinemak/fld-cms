import {
  mailTemplateSchema,
  meSchema,
  platformAccountPageSchema,
  platformSettingsViewSchema,
  resetAccountPasswordResultSchema,
} from '@fld/shared';
import type { INestApplication } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { z } from 'zod';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import {
  MailTransport,
  type MailMessage,
  type SmtpServer,
} from '../src/settings/mail.transport.js';
import { SnowflakeService } from '../src/snowflake/snowflake.service.js';
import { seedTenant } from '../src/tenants/tenant-seed.js';
import { createTestApp } from './app.js';

type TestAgent = ReturnType<typeof request.agent>;

const PASSWORD = 'plat-test-password';
const SYSTEM_TENANT = 1n;
const ENV_SERVER: SmtpServer = {
  host: 'smtp.fld.test',
  port: 2525,
  security: 'none',
  username: 'crm-mailer',
  password: 'env-smtp-password',
  fromAddress: 'crm@fld.test',
  fromName: 'FLD CRM',
};
const BLANK_SETTINGS = {
  smtpHost: null,
  smtpPort: null,
  smtpSecurity: null,
  smtpUsername: null,
  mailFromAddress: null,
  mailFromName: null,
  siteUrl: null,
};
const RESET_LINK = /http:\/\/crm\.fld\.test\/reset-password\?token=([\w-]+)/;

/** Keeps the mail instead of sending it. */
class Outbox extends MailTransport {
  readonly sent: { server: SmtpServer; message: MailMessage }[] = [];
  failure: Error | null = null;

  async send(server: SmtpServer, message: MailMessage): Promise<void> {
    if (this.failure) {
      throw this.failure;
    }
    this.sent.push({ server, message });
  }

  /** The mail to `to` sent after the first `after` ones, once it has arrived. */
  next(to: string, after: number): Promise<MailMessage> {
    return vi.waitFor(
      () => {
        const mail = this.sent.slice(after).find(({ message }) => message.to === to);
        if (!mail) {
          throw new Error(`No mail to ${to} yet`);
        }
        return mail.message;
      },
      { timeout: 5_000 },
    );
  }
}

function tokenIn(message: MailMessage): string {
  const match = RESET_LINK.exec(message.text);
  if (!match) {
    throw new Error(`No reset link in: ${message.text}`);
  }
  return match[1]!;
}

// Accounts across tenants, mail settings and resetting forgotten passwords, in order: each test
// builds on the state the previous ones left. It runs on a tenant and accounts of its own (all
// named plat-*), which it removes afterwards with the settings it saved.
describe('Platform accounts, settings and password reset (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: RedisService;
  let acmeId: bigint;
  let admin: TestAgent;
  let tenantAdmin: TestAgent;
  const outbox = new Outbox();
  /** Ids of the accounts, by username. */
  const ids: Record<string, string> = {};
  let alicePassword = PASSWORD;

  const signIn = async (account: string, password: string) => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/sign-in').send({ account, password }).expect(200);
    return agent;
  };
  const forgotPassword = (account: string) =>
    request(app.getHttpServer()).post('/api/auth/forgot-password').send({ account }).expect(202);
  const resetPassword = (token: string, newPassword: string) =>
    request(app.getHttpServer()).post('/api/auth/reset-password').send({ token, newPassword });

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder.overrideProvider(MailTransport).useValue(outbox),
    );
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    const snowflake = app.get(SnowflakeService);
    const nextId = () => snowflake.next();
    const passwordHash = await new PasswordHasher().hash(PASSWORD);
    const accounts = [
      { username: 'plat-admin', displayName: '平台管理员' },
      { username: 'plat-boss', displayName: 'Acme 管理员' },
      { username: 'plat-alice', displayName: '爱丽丝', email: 'plat-alice@fld.test' },
      { username: 'plat-carol', displayName: '卡罗尔', email: 'plat-carol@fld.test' },
      { username: 'plat-bob', displayName: '鲍勃' },
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
      // A platform administrator of the test's own, beside the super admin the bootstrap made.
      const memberId = nextId();
      await tx.tenantMember.create({
        data: { id: memberId, tenantId: SYSTEM_TENANT, userId: BigInt(ids['plat-admin']!) },
      });
      await tx.memberRole.create({
        data: { tenantId: SYSTEM_TENANT, memberId, roleId: superAdminRole.id },
      });
      await seedTenant(tx, nextId, {
        id: acmeId,
        code: 'plat-acme',
        name: 'Plat Acme',
        adminRole: { code: 'tenant_admin', name: '租户管理员' },
        adminUserId: BigInt(ids['plat-boss']!),
      });
      for (const username of ['plat-alice', 'plat-carol', 'plat-bob']) {
        await tx.tenantMember.create({
          data: { id: nextId(), tenantId: acmeId, userId: BigInt(ids[username]!) },
        });
      }
    });
    admin = await signIn('plat-admin', PASSWORD);
    tenantAdmin = await signIn('plat-boss', PASSWORD);
  });

  beforeEach(async () => {
    const keys = [
      ...(await redis.keys('fld:throttle:*')),
      ...(await redis.keys('fld:password-reset:*')),
    ];
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  afterAll(async () => {
    const users = Object.values(ids);
    await prisma.session.deleteMany({ where: { userId: { in: users } } });
    await prisma.emailToken.deleteMany({ where: { userId: { in: users } } });
    await prisma.platformSetting.deleteMany();
    await prisma.tenant.deleteMany({ where: { id: acmeId } });
    await prisma.user.deleteMany({ where: { id: { in: users.map((id) => BigInt(id)) } } });
    await app.close();
  });

  it('lists every account with the tenants it is in', async () => {
    const res = await admin.get('/api/system/accounts').query({ keyword: 'plat-' }).expect(200);
    const page = platformAccountPageSchema.parse(res.body);
    expect(page.total).toBe(5);
    expect(page.items.find(({ username }) => username === 'plat-admin')).toMatchObject({
      tenants: [{ id: '1' }],
    });
    expect(page.items.find(({ username }) => username === 'plat-alice')).toMatchObject({
      displayName: '爱丽丝',
      email: 'plat-alice@fld.test',
      status: 'ACTIVE',
      tenants: [{ id: acmeId.toString(), name: 'Plat Acme' }],
    });

    for (const keyword of ['PLAT-ALICE@', '爱丽']) {
      const found = platformAccountPageSchema.parse(
        (await admin.get('/api/system/accounts').query({ keyword }).expect(200)).body,
      );
      expect(found.items.map(({ username }) => username)).toEqual(['plat-alice']);
    }

    await tenantAdmin.get('/api/system/accounts').expect(403);
  });

  it("resets any account's password but its own, signing the account out everywhere", async () => {
    const alice = await signIn('plat-alice', alicePassword);
    const res = await admin
      .post(`/api/system/accounts/${ids['plat-alice']}/reset-password`)
      .expect(200);
    const { password } = resetAccountPasswordResultSchema.parse(res.body);
    await alice.get('/api/me').expect(401);
    const again = await signIn('plat-alice', password);
    const me = meSchema.parse((await again.get('/api/me').expect(200)).body);
    expect(me.user.mustChangePassword).toBe(true);
    alicePassword = password;

    const own = await admin
      .post(`/api/system/accounts/${ids['plat-admin']}/reset-password`)
      .expect(400);
    expect(own.body).toMatchObject({ message: '不能在这里重置自己的密码，请用「修改密码」' });
    await admin.post('/api/system/accounts/1/reset-password').expect(404);
    await tenantAdmin.post(`/api/system/accounts/${ids['plat-alice']}/reset-password`).expect(403);
  });

  it('takes mail settings from the page over the environment, and keeps the password encrypted', async () => {
    const initial = platformSettingsViewSchema.parse(
      (await admin.get('/api/system/settings').expect(200)).body,
    );
    expect(initial).toEqual({
      page: { ...BLANK_SETTINGS, smtpPassword: false },
      env: {
        smtpHost: 'smtp.fld.test',
        smtpPort: 2525,
        smtpSecurity: 'none',
        smtpUsername: 'crm-mailer',
        smtpPassword: true,
        mailFromAddress: 'crm@fld.test',
        mailFromName: 'FLD CRM',
        siteUrl: 'http://crm.fld.test',
      },
      mailReady: true,
      canStoreSecrets: true,
    });

    const saved = await admin
      .put('/api/system/settings')
      .send({
        smtpHost: 'smtp.page.test',
        smtpPort: '465',
        smtpSecurity: 'ssl',
        smtpUsername: 'page-mailer',
        smtpPassword: 'page-smtp-password',
        mailFromAddress: 'noreply@page.test',
        mailFromName: ' ',
        siteUrl: 'https://crm.page.test/',
      })
      .expect(200);
    expect(platformSettingsViewSchema.parse(saved.body).page).toEqual({
      smtpHost: 'smtp.page.test',
      smtpPort: 465,
      smtpSecurity: 'ssl',
      smtpUsername: 'page-mailer',
      smtpPassword: true,
      mailFromAddress: 'noreply@page.test',
      mailFromName: null,
      siteUrl: 'https://crm.page.test',
    });
    const stored = await prisma.platformSetting.findUniqueOrThrow({
      where: { key: 'mail.smtp.password' },
    });
    expect(stored.value).toMatch(/^v1\./);
    expect(stored.value).not.toContain('page-smtp-password');

    await admin
      .post('/api/system/settings/test-mail')
      .send({ to: 'plat-admin@fld.test' })
      .expect(204);
    expect(outbox.sent.at(-1)!.server).toEqual({
      host: 'smtp.page.test',
      port: 465,
      security: 'ssl',
      username: 'page-mailer',
      password: 'page-smtp-password',
      fromAddress: 'noreply@page.test',
      fromName: 'FLD CRM',
    });

    // Without smtpPassword, the saved one stays; blank fields fall back to the environment.
    const kept = await admin
      .put('/api/system/settings')
      .send({
        smtpHost: '',
        smtpPort: '',
        smtpSecurity: '',
        smtpUsername: '',
        mailFromAddress: '',
        mailFromName: '',
        siteUrl: '',
      })
      .expect(200);
    expect(platformSettingsViewSchema.parse(kept.body).page).toMatchObject({
      smtpHost: null,
      smtpPassword: true,
    });
    await admin
      .post('/api/system/settings/test-mail')
      .send({ to: 'plat-admin@fld.test' })
      .expect(204);
    expect(outbox.sent.at(-1)!.server).toEqual({ ...ENV_SERVER, password: 'page-smtp-password' });

    const cleared = await admin
      .put('/api/system/settings')
      .send({ ...BLANK_SETTINGS, smtpPassword: null })
      .expect(200);
    expect(platformSettingsViewSchema.parse(cleared.body).page).toEqual(initial.page);
    await admin
      .post('/api/system/settings/test-mail')
      .send({ to: 'plat-admin@fld.test' })
      .expect(204);
    expect(outbox.sent.at(-1)!.server).toEqual(ENV_SERVER);

    await admin
      .put('/api/system/settings')
      .send({ ...BLANK_SETTINGS, siteUrl: 'ftp://crm.page.test' })
      .expect(400);
    await admin
      .put('/api/system/settings')
      .send({ ...BLANK_SETTINGS, smtpPort: 0 })
      .expect(400);
    await tenantAdmin.get('/api/system/settings').expect(403);
  });

  it("sends a test mail, or says why the mail server wouldn't", async () => {
    await admin
      .post('/api/system/settings/test-mail')
      .send({ to: 'plat-admin@fld.test' })
      .expect(204);
    const { message } = outbox.sent.at(-1)!;
    expect(message).toMatchObject({ to: 'plat-admin@fld.test', subject: 'FLD CRM 测试邮件' });
    expect(message.html).toContain('<br>');

    outbox.failure = new Error('Invalid login: 535 Authentication failed');
    try {
      const res = await admin
        .post('/api/system/settings/test-mail')
        .send({ to: 'plat-admin@fld.test' })
        .expect(400);
      expect(res.body).toMatchObject({
        message: '发送失败：Invalid login: 535 Authentication failed',
      });
    } finally {
      outbox.failure = null;
    }
    await admin.post('/api/system/settings/test-mail').send({ to: 'not-an-address' }).expect(400);
  });

  it('edits the mail template and restores the built-in one', async () => {
    const templates = z
      .array(mailTemplateSchema)
      .parse((await admin.get('/api/system/mail-templates').expect(200)).body);
    expect(templates).toHaveLength(1);
    const [builtin] = templates;
    expect(builtin).toMatchObject({ key: 'password-reset', name: '重置密码', customized: false });
    expect(builtin!.placeholders.map(({ name }) => name)).toEqual([
      '姓名',
      '用户名',
      '重设链接',
      '有效分钟',
    ]);

    const edited = await admin
      .put('/api/system/mail-templates/password-reset')
      .send({ subject: '{{用户名}} 的新密码', body: '{{姓名}}：\n{{重设链接}}' })
      .expect(200);
    expect(mailTemplateSchema.parse(edited.body)).toMatchObject({
      subject: '{{用户名}} 的新密码',
      customized: true,
    });

    const sent = outbox.sent.length;
    await forgotPassword('plat-carol');
    const mail = await outbox.next('plat-carol@fld.test', sent);
    expect(mail.subject).toBe('plat-carol 的新密码');
    expect(mail.text).toMatch(/^卡罗尔：\nhttp:\/\/crm\.fld\.test\/reset-password\?token=/);

    const restored = await admin.delete('/api/system/mail-templates/password-reset').expect(200);
    expect(mailTemplateSchema.parse(restored.body)).toEqual(builtin);
    await admin.put('/api/system/mail-templates/other').send(edited.body).expect(400);
    await tenantAdmin.delete('/api/system/mail-templates/password-reset').expect(403);
  });

  it('mails a link that sets a new password once, and signs the account out everywhere', async () => {
    const alice = await signIn('plat-alice', alicePassword);
    const sent = outbox.sent.length;
    await forgotPassword(' Plat-Alice ');
    const mail = await outbox.next('plat-alice@fld.test', sent);
    expect(mail.subject).toBe('重设你的 FLD CRM 密码');
    expect(mail.text).toContain('爱丽丝，你好');
    expect(mail.text).toContain('plat-alice');
    expect(mail.text).toContain('30 分钟');
    const token = tokenIn(mail);
    expect(mail.html).toContain(`<a href="http://crm.fld.test/reset-password?token=${token}"`);

    await resetPassword(token, 'short').expect(400);
    await resetPassword(token, 'alice-new-password').expect(204);
    await alice.get('/api/me').expect(401);
    const again = await signIn('plat-alice', 'alice-new-password');
    const me = meSchema.parse((await again.get('/api/me').expect(200)).body);
    expect(me.user.mustChangePassword).toBe(false);
    alicePassword = 'alice-new-password';

    const reused = await resetPassword(token, 'alice-other-password').expect(400);
    expect(reused.body).toMatchObject({ message: '链接无效或已过期，请重新申请' });
  });

  it('answers every request alike, and mails one link a minute at most, the newest one working', async () => {
    const sent = outbox.sent.length;
    await forgotPassword('plat-nobody');
    await forgotPassword('plat-bob');
    await forgotPassword('plat-alice@fld.test');
    const first = tokenIn(await outbox.next('plat-alice@fld.test', sent));
    // Within the minute: answered the same, but nothing sent.
    await forgotPassword('plat-alice');
    // Mail to another account arrives after the requests before it are through.
    await forgotPassword('plat-carol');
    await outbox.next('plat-carol@fld.test', sent);
    expect(outbox.sent.slice(sent).map(({ message }) => message.to)).toEqual([
      'plat-alice@fld.test',
      'plat-carol@fld.test',
    ]);

    await redis.del(`fld:password-reset:minute:${ids['plat-alice']}`);
    const before = outbox.sent.length;
    await forgotPassword('plat-alice');
    const second = tokenIn(await outbox.next('plat-alice@fld.test', before));
    await resetPassword(first, 'alice-first-link').expect(400);

    await prisma.emailToken.updateMany({
      where: { userId: ids['plat-alice'] },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await resetPassword(second, 'alice-late-link').expect(400);
    await signIn('plat-alice', alicePassword);
  });

  it('stops mailing an account after five links in an hour', async () => {
    await redis.set(`fld:password-reset:hour:${ids['plat-carol']}`, '5', 'EX', 3600);
    const sent = outbox.sent.length;
    await forgotPassword('plat-carol');
    await forgotPassword('plat-alice');
    await outbox.next('plat-alice@fld.test', sent);
    expect(outbox.sent.slice(sent).map(({ message }) => message.to)).toEqual([
      'plat-alice@fld.test',
    ]);
  });
});
