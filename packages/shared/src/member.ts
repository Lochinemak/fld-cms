import { z } from 'zod';
import { accountChoiceSchema } from './account.js';
import { idSchema } from './id.js';
import { pageQuerySchema } from './pagination.js';

export const memberStatusSchema = z.enum(['ACTIVE', 'DISABLED']);
export type MemberStatus = z.infer<typeof memberStatusSchema>;

/** An account's membership of the current tenant. */
export const memberSchema = z.object({
  /** The membership's id, which the member endpoints take. */
  id: idSchema,
  userId: idSchema,
  username: z.string(),
  displayName: z.string(),
  email: z.string().nullable(),
  status: memberStatusSchema,
  /** Too many wrong passwords in a row locked the account, in every tenant it belongs to. */
  locked: z.boolean(),
  dept: z.object({ id: idSchema, name: z.string() }).nullable(),
  roles: z.array(z.object({ id: idSchema, name: z.string(), builtin: z.boolean() })),
  /** The account belongs to other tenants too, so its password can't be reset from this one. */
  sharedAccount: z.boolean(),
  joinedAt: z.iso.datetime(),
});
export type Member = z.infer<typeof memberSchema>;

export const memberQuerySchema = pageQuerySchema.extend({
  /** Members of this department and its sub-departments. */
  deptId: idSchema.optional(),
  status: memberStatusSchema.optional(),
});
export type MemberQuery = z.infer<typeof memberQuerySchema>;

const roleIdsSchema = z.array(idSchema).max(50, '最多分配 50 个角色');

export const createMemberSchema = z.object({
  account: accountChoiceSchema,
  deptId: idSchema,
  roleIds: roleIdsSchema.default([]),
});
export type CreateMemberInput = z.infer<typeof createMemberSchema>;

export const createMemberResultSchema = z.object({
  member: memberSchema,
  /** Present only when a new account was created with a generated password. */
  initialPassword: z.string().optional(),
});
export type CreateMemberResult = z.infer<typeof createMemberResultSchema>;

export const updateMemberSchema = z
  .object({ deptId: idSchema, roleIds: roleIdsSchema, status: memberStatusSchema })
  .partial()
  .refine((value) => Object.keys(value).length > 0, '至少修改一项');
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

export const resetMemberPasswordResultSchema = z.object({
  /** Generated and shown this once; it must be changed at the next sign-in. */
  password: z.string(),
});
export type ResetMemberPasswordResult = z.infer<typeof resetMemberPasswordResultSchema>;
