import { z } from 'zod';
import { idSchema } from './id.js';

export const departmentNameSchema = z.string().trim().min(1, '请输入部门名称').max(64);

export const departmentSortSchema = z
  .number('请输入排序号')
  .int('排序号须为整数')
  .min(0, '排序号不能小于 0')
  .max(9999, '排序号不能大于 9999');

export const departmentSchema = z.object({
  id: idSchema,
  /** Null for the tenant's root department. */
  parentId: idSchema.nullable(),
  name: z.string(),
  /** Siblings are listed by this, ascending. */
  sort: z.number().int(),
  /** Members in this department itself, not counting its sub-departments. */
  memberCount: z.number().int().nonnegative(),
});
export type Department = z.infer<typeof departmentSchema>;

export const createDepartmentSchema = z.object({
  parentId: idSchema,
  name: departmentNameSchema,
  sort: departmentSortSchema.default(0),
});
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z
  .object({ parentId: idSchema, name: departmentNameSchema, sort: departmentSortSchema })
  .partial()
  .refine((value) => Object.keys(value).length > 0, '至少修改一项');
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
