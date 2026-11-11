import {
  DEFAULT_APP_NAME,
  mailTemplateKeySchema,
  smtpSecuritySchema,
  type MailTemplate,
  type MailTemplateKey,
  type PlatformSettings,
  type PlatformSettingsView,
  type SmtpSecurity,
  type UpdateMailTemplateInput,
  type UpdatePlatformSettingsInput,
} from '@fld/shared';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService, changesOf } from '../audit/audit.service.js';
import type { Env } from '../config/env.js';
import { APP_NAME_PLACEHOLDER, MAIL_TEMPLATES } from './mail-templates.js';
import type { SmtpServer } from './mail.transport.js';
import { secretChange, SettingsStore, type SecretSetting } from './settings.store.js';

type Field = Exclude<keyof PlatformSettings, 'smtpPassword'>;

/** The site address the page saved. */
export const SITE_URL_KEY = 'site.url';

const KEYS: Record<Field, string> = {
  appName: 'site.name',
  smtpHost: 'mail.smtp.host',
  smtpPort: 'mail.smtp.port',
  smtpSecurity: 'mail.smtp.security',
  smtpUsername: 'mail.smtp.username',
  mailFromAddress: 'mail.from.address',
  mailFromName: 'mail.from.name',
  siteUrl: SITE_URL_KEY,
};
const PASSWORD: SecretSetting = {
  key: 'mail.smtp.password',
  label: '密码',
  envVar: 'SMTP_PASSWORD',
};
const DEFAULT_PORTS: Record<SmtpSecurity, number> = { ssl: 465, starttls: 587, none: 25 };

const SECURITY_WORDS: Record<SmtpSecurity, string> = {
  ssl: 'SSL/TLS',
  starttls: 'STARTTLS',
  none: '不加密',
};

const templateKeys = (key: MailTemplateKey) => ({
  subject: `mail.template.${key}.subject`,
  body: `mail.template.${key}.body`,
});

interface PageSettings {
  settings: PlatformSettings;
  password: string | null;
}

/**
 * Mail and site settings. Each one set on the settings page overrides its environment variable,
 * and clearing it there brings the variable back. The page's SMTP password is stored encrypted,
 * which takes SETTINGS_ENCRYPTION_KEY.
 */
@Injectable()
export class PlatformSettingsService {
  private readonly env: PlatformSettings;
  private readonly envPassword: string | null;

  constructor(
    private readonly store: SettingsStore,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
  ) {
    this.envPassword = config.get('SMTP_PASSWORD', { infer: true }) ?? null;
    this.env = {
      appName: null,
      smtpHost: config.get('SMTP_HOST', { infer: true }) ?? null,
      smtpPort: config.get('SMTP_PORT', { infer: true }) ?? null,
      smtpSecurity: config.get('SMTP_SECURITY', { infer: true }) ?? null,
      smtpUsername: config.get('SMTP_USERNAME', { infer: true }) ?? null,
      smtpPassword: this.envPassword !== null,
      mailFromAddress: config.get('MAIL_FROM_ADDRESS', { infer: true }) ?? null,
      mailFromName: config.get('MAIL_FROM_NAME', { infer: true }) ?? null,
      siteUrl: config.get('SITE_URL', { infer: true }) ?? null,
    };
  }

  async view(): Promise<PlatformSettingsView> {
    const page = await this.page();
    return {
      page: page.settings,
      env: this.env,
      mailReady: this.ready(page),
      canStoreSecrets: this.store.box !== null,
    };
  }

  /** Whether links can be mailed: a mail server, a sender and the site address are set. */
  async mailReady(): Promise<boolean> {
    return this.ready(await this.page());
  }

  async update(input: UpdatePlatformSettingsInput): Promise<PlatformSettingsView> {
    const values: [string, string | null][] = [
      [KEYS.appName, input.appName],
      [KEYS.smtpHost, input.smtpHost],
      [KEYS.smtpPort, input.smtpPort === null ? null : String(input.smtpPort)],
      [KEYS.smtpSecurity, input.smtpSecurity],
      [KEYS.smtpUsername, input.smtpUsername],
      [KEYS.mailFromAddress, input.mailFromAddress],
      [KEYS.mailFromName, input.mailFromName],
      [KEYS.siteUrl, input.siteUrl],
      ...this.store.sealSecret(PASSWORD, input.smtpPassword),
    ];
    const before = (await this.page()).settings;
    await this.store.write(values);
    const view = await this.view();
    const after = view.page;
    const security = (value: SmtpSecurity | null) => value && SECURITY_WORDS[value];
    const changes = changesOf([
      ['系统名称', before.appName, after.appName],
      ['SMTP 服务器', before.smtpHost, after.smtpHost],
      ['端口', before.smtpPort, after.smtpPort],
      ['加密方式', security(before.smtpSecurity), security(after.smtpSecurity)],
      ['SMTP 用户名', before.smtpUsername, after.smtpUsername],
      [
        'SMTP 密码',
        null,
        secretChange(input.smtpPassword, before.smtpPassword, after.smtpPassword),
      ],
      ['发件人地址', before.mailFromAddress, after.mailFromAddress],
      ['发件人名称', before.mailFromName, after.mailFromName],
      ['网站地址', before.siteUrl, after.siteUrl],
    ]);
    if (changes.length > 0) {
      await this.audit.record({
        action: 'settings.update',
        target: { type: 'settings', name: '邮件和网站' },
        changes,
      });
    }
    return view;
  }

  /** The mail server to send with, or null while no host or sender address is set. */
  async smtpServer(): Promise<SmtpServer | null> {
    return this.server(await this.page());
  }

  /** The address the site is reached at, without a trailing slash, or null. */
  async siteUrl(): Promise<string | null> {
    return this.effective((await this.page()).settings, 'siteUrl');
  }

  /** What the product is called: the name the page saved, or the default one. */
  async appName(): Promise<string> {
    const rows = await this.store.read([KEYS.appName]);
    return rows.get(KEYS.appName) ?? DEFAULT_APP_NAME;
  }

  mailTemplates(): Promise<MailTemplate[]> {
    return Promise.all(mailTemplateKeySchema.options.map((key) => this.mailTemplate(key)));
  }

  async mailTemplate(key: MailTemplateKey): Promise<MailTemplate> {
    const keys = templateKeys(key);
    const rows = await this.store.read([keys.subject, keys.body, KEYS.appName]);
    const appName = rows.get(KEYS.appName) ?? DEFAULT_APP_NAME;
    const { name, subject, body, placeholders } = MAIL_TEMPLATES[key];
    return {
      key,
      name,
      subject: rows.get(keys.subject) ?? subject,
      body: rows.get(keys.body) ?? body,
      customized: rows.has(keys.subject) || rows.has(keys.body),
      defaultSubject: subject,
      defaultBody: body,
      // The preview shows the product's name as it is, not an example of one.
      placeholders: placeholders.map((placeholder) =>
        placeholder.name === APP_NAME_PLACEHOLDER
          ? { ...placeholder, example: appName }
          : placeholder,
      ),
    };
  }

  async updateMailTemplate(
    key: MailTemplateKey,
    input: UpdateMailTemplateInput,
  ): Promise<MailTemplate> {
    const keys = templateKeys(key);
    const before = await this.mailTemplate(key);
    await this.store.write([
      [keys.subject, input.subject],
      [keys.body, input.body],
    ]);
    const after = await this.mailTemplate(key);
    const changes = changesOf([
      ['主题', before.subject, after.subject],
      // Bodies are long: only that it changed.
      ['正文', null, before.body === after.body ? null : '已修改'],
    ]);
    if (changes.length > 0) {
      await this.audit.record({
        action: 'mail-template.update',
        target: { type: 'mail-template', name: after.name },
        changes,
      });
    }
    return after;
  }

  async resetMailTemplate(key: MailTemplateKey): Promise<MailTemplate> {
    const keys = templateKeys(key);
    await this.store.write([
      [keys.subject, null],
      [keys.body, null],
    ]);
    const template = await this.mailTemplate(key);
    await this.audit.record({
      action: 'mail-template.reset',
      target: { type: 'mail-template', name: template.name },
    });
    return template;
  }

  private async page(): Promise<PageSettings> {
    const rows = await this.store.read([...Object.values(KEYS), PASSWORD.key]);
    const password = this.store.openSecret(PASSWORD, rows);
    const port = rows.get(KEYS.smtpPort);
    const security = smtpSecuritySchema.safeParse(rows.get(KEYS.smtpSecurity));
    return {
      settings: {
        appName: rows.get(KEYS.appName) ?? null,
        smtpHost: rows.get(KEYS.smtpHost) ?? null,
        smtpPort: port === undefined ? null : Number(port),
        smtpSecurity: security.success ? security.data : null,
        smtpUsername: rows.get(KEYS.smtpUsername) ?? null,
        smtpPassword: password !== null,
        mailFromAddress: rows.get(KEYS.mailFromAddress) ?? null,
        mailFromName: rows.get(KEYS.mailFromName) ?? null,
        siteUrl: rows.get(KEYS.siteUrl) ?? null,
      },
      password,
    };
  }

  private ready(page: PageSettings): boolean {
    return this.server(page) !== null && this.effective(page.settings, 'siteUrl') !== null;
  }

  private server({ settings, password }: PageSettings): SmtpServer | null {
    const host = this.effective(settings, 'smtpHost');
    const fromAddress = this.effective(settings, 'mailFromAddress');
    if (!host || !fromAddress) {
      return null;
    }
    const port = this.effective(settings, 'smtpPort');
    const security =
      this.effective(settings, 'smtpSecurity') ?? (port === 465 ? 'ssl' : 'starttls');
    return {
      host,
      port: port ?? DEFAULT_PORTS[security],
      security,
      username: this.effective(settings, 'smtpUsername'),
      password: password ?? this.envPassword,
      fromAddress,
      fromName: this.effective(settings, 'mailFromName'),
    };
  }

  private effective<K extends Field>(page: PlatformSettings, field: K): PlatformSettings[K] {
    return page[field] ?? this.env[field];
  }
}
