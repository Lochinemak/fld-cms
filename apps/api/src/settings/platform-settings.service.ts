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
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MAIL_TEMPLATES } from './mail-templates.js';
import type { SmtpServer } from './mail.transport.js';
import { SecretBox } from './secret-box.js';

type Field = Exclude<keyof PlatformSettings, 'smtpPassword'>;

const KEYS: Record<Field, string> = {
  smtpHost: 'mail.smtp.host',
  smtpPort: 'mail.smtp.port',
  smtpSecurity: 'mail.smtp.security',
  smtpUsername: 'mail.smtp.username',
  mailFromAddress: 'mail.from.address',
  mailFromName: 'mail.from.name',
  siteUrl: 'site.url',
};
const PASSWORD_KEY = 'mail.smtp.password';
const DEFAULT_PORTS: Record<SmtpSecurity, number> = { ssl: 465, starttls: 587, none: 25 };

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
  private readonly box: SecretBox | null;
  private readonly env: PlatformSettings;
  private readonly envPassword: string | null;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    const key = config.get('SETTINGS_ENCRYPTION_KEY', { infer: true });
    this.box = key ? new SecretBox(Buffer.from(key, 'base64')) : null;
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
      canStoreSecrets: this.box !== null,
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
      if (!this.box) {
        throw new BadRequestException(
          '没有配置 SETTINGS_ENCRYPTION_KEY，不能在页面上保存密码；可以改用环境变量 SMTP_PASSWORD',
        );
      }
      values.push([PASSWORD_KEY, this.box.seal(PASSWORD_KEY, input.smtpPassword)]);
    } else if (input.smtpPassword !== undefined) {
      values.push([PASSWORD_KEY, null]);
    }
    await this.write(values);
    return this.view();
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
    const rows = await this.read([keys.subject, keys.body]);
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
    await this.write([
      [keys.subject, input.subject],
      [keys.body, input.body],
    ]);
    return this.mailTemplate(key);
  }

  async resetMailTemplate(key: MailTemplateKey): Promise<MailTemplate> {
    const keys = templateKeys(key);
    await this.write([
      [keys.subject, null],
      [keys.body, null],
    ]);
    return this.mailTemplate(key);
  }

  private async page(): Promise<PageSettings> {
    const rows = await this.read([...Object.values(KEYS), PASSWORD_KEY]);
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
    const password = this.box?.open(PASSWORD_KEY, sealed) ?? null;
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

  private async read(keys: string[]): Promise<Map<string, string>> {
    const rows = await this.prisma.platformSetting.findMany({ where: { key: { in: keys } } });
    return new Map(rows.map((row) => [row.key, row.value]));
  }

  /** Stores each value, or deletes it for null. */
  private async write(values: [string, string | null][]): Promise<void> {
    await this.prisma.$transaction(
      values.map(([key, value]) =>
        value === null
          ? this.prisma.platformSetting.deleteMany({ where: { key } })
          : this.prisma.platformSetting.upsert({
              where: { key },
              create: { key, value },
              update: { value },
            }),
      ),
    );
  }
}
