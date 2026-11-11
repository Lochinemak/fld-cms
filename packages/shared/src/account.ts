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

/** The ways to sign in, besides a password, that the sign-in page offers. */
export const signInOptionsSchema = z.object({ logto: z.boolean() });
export type SignInOptions = z.infer<typeof signInOptionsSchema>;

/**
 * Why a sign-in with Logto didn't go through: the sign-in page gets the code as its `error`, and
 * says the words.
 */
export const LOGTO_SIGN_IN_ERRORS = {
  'no-email': '你的 Logto 账号没有已验证的邮箱，无法对应到 CRM 账号，请联系管理员',
  'no-account': '还没有与你的 Logto 账号对应的 CRM 账号，请联系管理员',
  linked: '这个邮箱的 CRM 账号已经对应了另一个 Logto 账号，请联系管理员',
  disabled: '账号已停用，请联系管理员',
  locked: '账号已锁定，请联系管理员解锁，或用忘记密码重设',
  cancelled: '已取消 Logto 登录',
  off: 'Logto 登录没有开启',
  unavailable: '暂时连不上 Logto，请稍后再试',
  failed: 'Logto 登录没有完成，请再试一次',
} as const;
export type LogtoSignInError = keyof typeof LOGTO_SIGN_IN_ERRORS;

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

/** How long a password reset link works, in minutes. */
export const PASSWORD_RESET_MINUTES = 30;

export const forgotPasswordSchema = z.object({
  account: z.string().trim().min(1, '请输入用户名或邮箱').max(254),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

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
