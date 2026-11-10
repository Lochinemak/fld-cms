import { z } from 'zod';
import { idSchema } from './id.js';
import { PERMISSION_CODES } from './permissions.js';

/**
 * Which rows a role may see: everything, its member's department with or without the
 * sub-departments, only the member's own rows, or a chosen set of departments.
 */
export const dataScopeSchema = z.enum(['ALL', 'DEPT_AND_CHILDREN', 'DEPT', 'SELF', 'CUSTOM']);
export type DataScope = z.infer<typeof dataScopeSchema>;

export const permissionCodeSchema = z.enum(PERMISSION_CODES, '未知的权限');

export const roleCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_-]{1,63}$/, '角色编码为 2–64 位小写字母、数字、_ 或 -，以字母开头');

export const roleNameSchema = z.string().trim().min(1, '请输入角色名称').max(64);

export const roleSchema = z.object({
  id: idSchema,
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  /** The tenant's administrator role: every permission the tenant may grant, and read-only. */
  builtin: z.boolean(),
  dataScope: dataScopeSchema,
  /** The departments a CUSTOM data scope covers; empty for the other scopes. */
  deptIds: z.array(idSchema),
  permissions: z.array(permissionCodeSchema),
  memberCount: z.number().int().nonnegative(),
});
export type Role = z.infer<typeof roleSchema>;

const roleFields = {
  name: roleNameSchema,
  /** Empty for none. */
  description: z.string().trim().max(255, '描述最多 255 个字').default(''),
  dataScope: dataScopeSchema,
  deptIds: z.array(idSchema).max(1000).default([]),
  permissions: z.array(permissionCodeSchema).max(500).default([]),
};

const hasCustomDepartments = (role: { dataScope: DataScope; deptIds: string[] }) =>
  role.dataScope !== 'CUSTOM' || role.deptIds.length > 0;
const noCustomDepartments = { message: '自定义数据范围至少选择一个部门', path: ['deptIds'] };

export const createRoleSchema = z
  .object({ code: roleCodeSchema, ...roleFields })
  .refine(hasCustomDepartments, noCustomDepartments);
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

/** Everything about a role but its code, which never changes once created. */
export const updateRoleSchema = z
  .object(roleFields)
  .refine(hasCustomDepartments, noCustomDepartments);
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
