import {
  mailTemplateSchema,
  platformAccountPageSchema,
  platformAccountSchema,
  platformSettingsViewSchema,
  resetAccountPasswordResultSchema,
  type MailTemplateKey,
  type TestMailInput,
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

export const platformSettingsQuery = queryOptions({
  queryKey: ['system', 'settings'],
  queryFn: () => api('/system/settings', { schema: platformSettingsViewSchema }),
});

export const updatePlatformSettings = (input: UpdatePlatformSettingsInput) =>
  api('/system/settings', { method: 'PUT', json: input, schema: platformSettingsViewSchema });

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
