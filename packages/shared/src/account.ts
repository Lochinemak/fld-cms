import { z } from 'zod';
import { idSchema } from './id.js';

export const SYSTEM_TENANT_ID = '1';

/**
 * The tenant the browser tab believes it works in. The API answers 409 when the session has
 * switched to another tenant meanwhile (in another tab), so nothing is written to the wrong one.
 */
export const TENANT_HEADER = 'x-tenant-id';
export const TENANT_SWITCHED_ERROR = 'tenant_switched';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `密码至少 ${PASSWORD_MIN_LENGTH} 位`)
  .max(PASSWORD_MAX_LENGTH, `密码最多 ${PASSWORD_MAX_LENGTH} 位`);

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{2,63}$/, '用户名为 3–64 位小写字母、数字或 . _ -，以字母或数字开头');

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email('邮箱格式不正确'));

export const displayNameSchema = z.string().trim().min(1, '请输入姓名').max(64);

/** An account to give access to: one that already exists, or a new one. */
export const accountChoiceSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('existing'),
    /** Username or email of the existing account. */
    account: z.string().trim().min(1, '请输入用户名或邮箱').max(254),
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
export type AccountChoice = z.infer<typeof accountChoiceSchema>;

export const signInSchema = z.object({
  /** Username or email. */
  account: z.string().trim().min(1, '请输入用户名或邮箱').max(254),
  password: z.string().min(1, '请输入密码').max(PASSWORD_MAX_LENGTH),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, '请输入当前密码').max(PASSWORD_MAX_LENGTH),
    newPassword: passwordSchema,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: '新密码不能与当前密码相同',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const switchTenantSchema = z.object({ tenantId: idSchema });
export type SwitchTenantInput = z.infer<typeof switchTenantSchema>;

export const tenantSummarySchema = z.object({
  id: idSchema,
  code: z.string(),
  name: z.string(),
  isSystem: z.boolean(),
});
export type TenantSummary = z.infer<typeof tenantSummarySchema>;

export const meSchema = z.object({
  user: z.object({
    id: idSchema,
    username: z.string(),
    email: z.string().nullable(),
    displayName: z.string(),
    mustChangePassword: z.boolean(),
  }),
  /** Null when the account belongs to no active tenant. */
  tenant: tenantSummarySchema.nullable(),
  tenants: z.array(tenantSummarySchema),
  /** Effective permission codes in the current tenant. */
  permissions: z.array(z.string()),
});
export type Me = z.infer<typeof meSchema>;
