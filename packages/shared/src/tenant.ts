import { z } from 'zod';
import { accountChoiceSchema } from './account.js';
import { idSchema } from './id.js';
import { pageSchema } from './pagination.js';

export const tenantStatusSchema = z.enum(['ACTIVE', 'DISABLED']);
export type TenantStatus = z.infer<typeof tenantStatusSchema>;

export const tenantCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9-]{1,63}$/, '租户编码为 2–64 位小写字母、数字或 -，以字母开头');

export const tenantNameSchema = z.string().trim().min(1, '请输入租户名称').max(128);

export const tenantSchema = z.object({
  id: idSchema,
  code: z.string(),
  name: z.string(),
  status: tenantStatusSchema,
  memberCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
});
export type Tenant = z.infer<typeof tenantSchema>;

export const tenantPageSchema = pageSchema(tenantSchema);

export const createTenantSchema = z.object({
  code: tenantCodeSchema,
  name: tenantNameSchema,
  /** The tenant's first administrator. */
  admin: accountChoiceSchema,
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export const tenantAdminSchema = z.object({
  id: idSchema,
  username: z.string(),
  /** Present only when the account was created with a generated password. */
  initialPassword: z.string().optional(),
});
export type TenantAdmin = z.infer<typeof tenantAdminSchema>;

export const createTenantResultSchema = z.object({
  tenant: tenantSchema,
  admin: tenantAdminSchema,
});
export type CreateTenantResult = z.infer<typeof createTenantResultSchema>;

export const resetTenantAdminSchema = z.object({
  /** Becomes an administrator of the tenant; the ones it has keep their role. */
  admin: accountChoiceSchema,
});
export type ResetTenantAdminInput = z.infer<typeof resetTenantAdminSchema>;

export const updateTenantSchema = z
  .object({ name: tenantNameSchema, status: tenantStatusSchema })
  .partial()
  .refine((value) => Object.keys(value).length > 0, '至少修改一项');
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
