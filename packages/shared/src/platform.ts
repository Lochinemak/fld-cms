import { z } from 'zod';
import { emailSchema } from './account.js';
import { idSchema } from './id.js';
import { pageSchema } from './pagination.js';

/** An account as the platform sees it: one sign-in, whichever tenants it belongs to. */
export const platformAccountSchema = z.object({
  id: idSchema,
  username: z.string(),
  displayName: z.string(),
  email: z.string().nullable(),
  status: z.enum(['ACTIVE', 'DISABLED']),
  lastSignInAt: z.iso.datetime().nullable(),
  /** The tenants it is an active member of. */
  tenants: z.array(z.object({ id: idSchema, name: z.string() })),
});
export type PlatformAccount = z.infer<typeof platformAccountSchema>;

export const platformAccountPageSchema = pageSchema(platformAccountSchema);

export const resetAccountPasswordResultSchema = z.object({ password: z.string() });
export type ResetAccountPasswordResult = z.infer<typeof resetAccountPasswordResultSchema>;

export const smtpSecuritySchema = z.enum(['ssl', 'starttls', 'none']);
export type SmtpSecurity = z.infer<typeof smtpSecuritySchema>;

/** Mail and site settings, null where unset. The SMTP password is never sent back, only whether one is set. */
export const platformSettingsSchema = z.object({
  smtpHost: z.string().nullable(),
  smtpPort: z.number().int().nullable(),
  smtpSecurity: smtpSecuritySchema.nullable(),
  smtpUsername: z.string().nullable(),
  smtpPassword: z.boolean(),
  mailFromAddress: z.string().nullable(),
  mailFromName: z.string().nullable(),
  siteUrl: z.string().nullable(),
});
export type PlatformSettings = z.infer<typeof platformSettingsSchema>;

export const platformSettingsViewSchema = z.object({
  /** Set on the settings page; each one overrides its environment variable. */
  page: platformSettingsSchema,
  /** Set by environment variables. */
  env: platformSettingsSchema,
  /** Whether forgotten passwords can be reset by mail: a mail server, a sender and the site address are set. */
  mailReady: z.boolean(),
  /** Whether the page may store a password, which takes SETTINGS_ENCRYPTION_KEY. */
  canStoreSecrets: z.boolean(),
});
export type PlatformSettingsView = z.infer<typeof platformSettingsViewSchema>;

/** Blank form fields clear the page's value, so that the environment variable applies again. */
function unlessBlank<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    schema.nullable(),
  );
}

export const updatePlatformSettingsSchema = z.object({
  smtpHost: unlessBlank(z.string().trim().max(253)),
  smtpPort: unlessBlank(
    z.coerce
      .number()
      .int('端口应为 1–65535')
      .min(1, '端口应为 1–65535')
      .max(65535, '端口应为 1–65535'),
  ),
  smtpSecurity: unlessBlank(smtpSecuritySchema),
  smtpUsername: unlessBlank(z.string().trim().max(254)),
  /** A new password; null clears the page's one; absent keeps it. */
  smtpPassword: z.string().max(1024).nullable().optional(),
  mailFromAddress: unlessBlank(emailSchema),
  mailFromName: unlessBlank(z.string().trim().max(64)),
  siteUrl: unlessBlank(
    z
      .url({ protocol: /^https?$/, error: '请输入 http:// 或 https:// 开头的地址' })
      .transform((url) => url.replace(/\/+$/, '')),
  ),
});
export type UpdatePlatformSettingsInput = z.infer<typeof updatePlatformSettingsSchema>;

export const testMailSchema = z.object({ to: emailSchema });
export type TestMailInput = z.infer<typeof testMailSchema>;

export const mailTemplateKeySchema = z.enum(['password-reset']);
export type MailTemplateKey = z.infer<typeof mailTemplateKeySchema>;

export const mailTemplateSchema = z.object({
  key: mailTemplateKeySchema,
  name: z.string(),
  subject: z.string(),
  body: z.string(),
  /** Whether the page changed it from the built-in one. */
  customized: z.boolean(),
  defaultSubject: z.string(),
  defaultBody: z.string(),
  /** What each {{placeholder}} it may use stands for. */
  placeholders: z.array(
    z.object({ name: z.string(), description: z.string(), example: z.string() }),
  ),
});
export type MailTemplate = z.infer<typeof mailTemplateSchema>;

export const updateMailTemplateSchema = z.object({
  subject: z.string().trim().min(1, '请输入邮件主题').max(200),
  body: z.string().trim().min(1, '请输入邮件正文').max(10_000),
});
export type UpdateMailTemplateInput = z.infer<typeof updateMailTemplateSchema>;

/** Fills each {{placeholder}} it has a value for; others stay as written. */
export function renderMailTemplate(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return template.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? values[name]! : placeholder,
  );
}
