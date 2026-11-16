import {
  logtoSettingsViewSchema,
  mailTemplateSchema,
  platformAccountPageSchema,
  platformAccountSchema,
  platformSettingsViewSchema,
  resetAccountPasswordResultSchema,
  type LogtoSettingsView,
  type MailTemplateKey,
  type TestMailInput,
  type UpdateLogtoSettingsInput,
  type UpdateMailTemplateInput,
  type UpdatePlatformSettingsInput,
} from '@fld/shared';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from './api';
import { listPath, type TenantListParams } from './system';

export const accountsQuery = (params: TenantListParams) =>
  queryOptions({
    queryKey: ['system', 'accounts', params],
    queryFn: () => api(listPath('/system/accounts', params), { schema: platformAccountPageSchema }),
    placeholderData: keepPreviousData,
  });

export const resetAccountPassword = (id: string) =>
  api(`/system/accounts/${id}/reset-password`, {
    method: 'POST',
    schema: resetAccountPasswordResultSchema,
  });

export const unlockAccount = (id: string) =>
  api(`/system/accounts/${id}/unlock`, { method: 'POST', schema: platformAccountSchema });

export const resetAccountMfa = (id: string) =>
  api(`/system/accounts/${id}/reset-mfa`, { method: 'POST', schema: platformAccountSchema });

export const signOutAccount = (id: string) =>
  api(`/system/accounts/${id}/sign-out`, { method: 'POST' });

export const platformSettingsQuery = queryOptions({
  queryKey: ['system', 'settings'],
  queryFn: () => api('/system/settings', { schema: platformSettingsViewSchema }),
});

export const updatePlatformSettings = (input: UpdatePlatformSettingsInput) =>
  api('/system/settings', { method: 'PUT', json: input, schema: platformSettingsViewSchema });

export const logtoSettingsQuery = queryOptions({
  queryKey: ['system', 'settings', 'logto'],
  queryFn: () => api('/system/settings/logto', { schema: logtoSettingsViewSchema }),
});

export const updateLogtoSettings = (input: UpdateLogtoSettingsInput) =>
  api('/system/settings/logto', { method: 'PUT', json: input, schema: logtoSettingsViewSchema });

export const sendTestMail = (input: TestMailInput) =>
  api('/system/settings/test-mail', { method: 'POST', json: input });

export const mailTemplatesQuery = queryOptions({
  queryKey: ['system', 'mail-templates'],
  queryFn: () => api('/system/mail-templates', { schema: z.array(mailTemplateSchema) }),
});

export const updateMailTemplate = (key: MailTemplateKey, input: UpdateMailTemplateInput) =>
  api(`/system/mail-templates/${key}`, { method: 'PUT', json: input, schema: mailTemplateSchema });

/** Back to the built-in template. */
export const resetMailTemplate = (key: MailTemplateKey) =>
  api(`/system/mail-templates/${key}`, { method: 'DELETE', schema: mailTemplateSchema });

/** Under a field: what applies while it is left blank. */
export function blankHint(
  envValue: string | number | null,
  otherwise?: string,
): string | undefined {
  return envValue === null ? otherwise : `留空则用环境变量的值：${envValue}`;
}

/** What is still to fill in before the sign-in page offers Logto. */
export function logtoMissing({ page, env, callbackUrl }: LogtoSettingsView): string[] {
  const missing: string[] = [];
  if (!(page.url ?? env.url)) {
    missing.push('Logto 地址');
  }
  if (!(page.appId ?? env.appId)) {
    missing.push('应用 ID');
  }
  if (!page.appSecret && !env.appSecret) {
    missing.push('应用密钥');
  }
  if (callbackUrl === null) {
    missing.push('站点地址（在上面的「邮件服务」里）');
  }
  return missing;
}
