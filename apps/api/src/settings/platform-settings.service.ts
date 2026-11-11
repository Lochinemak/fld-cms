import {
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
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService, changesOf } from '../audit/audit.service.js';
import type { Env } from '../config/env.js';
import { MAIL_TEMPLATES } from './mail-templates.js';
import type { SmtpServer } from './mail.transport.js';
import { SettingsStore } from './settings.store.js';

type Field = Exclude<keyof PlatformSettings, 'smtpPassword'>;

/** The site address the page saved. */
export const SITE_URL_KEY = 'site.url';

const KEYS: Record<Field, string> = {
  smtpHost: 'mail.smtp.host',
  smtpPort: 'mail.smtp.port',
  smtpSecurity: 'mail.smtp.security',
  smtpUsername: 'mail.smtp.username',
  mailFromAddress: 'mail.from.address',
  mailFromName: 'mail.from.name',
  siteUrl: SITE_URL_KEY,
};
const PASSWORD_KEY = 'mail.smtp.password';
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
  private readonly logger = new Logger(PlatformSettingsService.name);
  private readonly env: PlatformSettings;
  private readonly envPassword: string | null;

  constructor(
    private readonly store: SettingsStore,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
  ) {
    this.envPassword = config.get('SMTP_PASSWORD', { infer: true }) ?? null;
    this.env = {
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
      [KEYS.smtpHost, input.smtpHost],
      [KEYS.smtpPort, input.smtpPort === null ? null : String(input.smtpPort)],
      [KEYS.smtpSecurity, input.smtpSecurity],
      [KEYS.smtpUsername, input.smtpUsername],
      [KEYS.mailFromAddress, input.mailFromAddress],
      [KEYS.mailFromName, input.mailFromName],
      [KEYS.siteUrl, input.siteUrl],
    ];
    if (input.smtpPassword) {
      if (!this.store.box) {
        throw new BadRequestException(
          '没有配置 SETTINGS_ENCRYPTION_KEY，不能在页面上保存密码；可以改用环境变量 SMTP_PASSWORD',
        );
      }
      values.push([PASSWORD_KEY, this.store.box.seal(PASSWORD_KEY, input.smtpPassword)]);
    } else if (input.smtpPassword !== undefined) {
      values.push([PASSWORD_KEY, null]);
    }
    const before = (await this.page()).settings;
    await this.store.write(values);
    const view = await this.view();
    const after = view.page;
    const security = (value: SmtpSecurity | null) => value && SECURITY_WORDS[value];
    // Never the password itself.
    const cleared = before.smtpPassword && !after.smtpPassword;
    const password = input.smtpPassword ? '已更换' : cleared ? '已清除' : null;
    const changes = changesOf([
      ['SMTP 服务器', before.smtpHost, after.smtpHost],
      ['端口', before.smtpPort, after.smtpPort],
      ['加密方式', security(before.smtpSecurity), security(after.smtpSecurity)],
      ['SMTP 用户名', before.smtpUsername, after.smtpUsername],
      ['SMTP 密码', null, password],
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

  mailTemplates(): Promise<MailTemplate[]> {
    return Promise.all(mailTemplateKeySchema.options.map((key) => this.mailTemplate(key)));
  }

  async mailTemplate(key: MailTemplateKey): Promise<MailTemplate> {
    const keys = templateKeys(key);
    const rows = await this.store.read([keys.subject, keys.body]);
    const { name, subject, body, placeholders } = MAIL_TEMPLATES[key];
    return {
      key,
      name,
      subject: rows.get(keys.subject) ?? subject,
      body: rows.get(keys.body) ?? body,
      customized: rows.size > 0,
      defaultSubject: subject,
      defaultBody: body,
      placeholders,
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
    const rows = await this.store.read([...Object.values(KEYS), PASSWORD_KEY]);
    const sealed = rows.get(PASSWORD_KEY);
    const password = sealed === undefined ? null : this.open(sealed);
    const port = rows.get(KEYS.smtpPort);
    const security = smtpSecuritySchema.safeParse(rows.get(KEYS.smtpSecurity));
    return {
      settings: {
        smtpHost: rows.get(KEYS.smtpHost) ?? null,
        smtpPort: port === undefined ? null : Number(port),
        smtpSecurity: security.success ? security.data : null,
        smtpUsername: rows.get(KEYS.smtpUsername) ?? null,
        // A password that no longer opens (the key changed) shows as unset, to be entered again.
        smtpPassword: password !== null,
        mailFromAddress: rows.get(KEYS.mailFromAddress) ?? null,
        mailFromName: rows.get(KEYS.mailFromName) ?? null,
        siteUrl: rows.get(KEYS.siteUrl) ?? null,
      },
      password,
    };
  }

  private open(sealed: string): string | null {
    const password = this.store.box?.open(PASSWORD_KEY, sealed) ?? null;
    if (password === null) {
      this.logger.warn(
        'The SMTP password saved on the settings page does not decrypt with SETTINGS_ENCRYPTION_KEY: save it again',
      );
    }
    return password;
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
