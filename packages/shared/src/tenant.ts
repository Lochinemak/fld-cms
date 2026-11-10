import { z } from 'zod';
import { displayNameSchema, emailSchema, passwordSchema, usernameSchema } from './account.js';
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

/** The tenant's first administrator: an account that already exists, or a new one. */
export const tenantAdminInputSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('existing'),
    /** Username or email of the existing account. */
    account: z.string().trim().min(1).max(254),
  }),
  z.object({
    mode: z.literal('new'),
    username: usernameSchema,
    displayName: displayNameSchema,
    email: emailSchema.optional(),
    /** Generated (and returned once) when left out. */
    password: passwordSchema.optional(),
  }),
]);
export type TenantAdminInput = z.infer<typeof tenantAdminInputSchema>;

export const createTenantSchema = z.object({
  code: tenantCodeSchema,
  name: tenantNameSchema,
  admin: tenantAdminInputSchema,
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export const createTenantResultSchema = z.object({
  tenant: tenantSchema,
  admin: z.object({
    id: idSchema,
    username: z.string(),
    /** Present only when the account was created with a generated password. */
    initialPassword: z.string().optional(),
  }),
});
export type CreateTenantResult = z.infer<typeof createTenantResultSchema>;

export const updateTenantSchema = z
  .object({ name: tenantNameSchema, status: tenantStatusSchema })
  .partial()
  .refine((value) => Object.keys(value).length > 0, '至少修改一项');
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
