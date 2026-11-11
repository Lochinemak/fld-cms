import { z } from 'zod';
import { idSchema } from './id.js';
import type { PermissionCode } from './permissions.js';

// Data dictionaries: lists of options a tenant edits on its own, which select fields offer.

/** What dictionary values and field keys look like: stable codes, apart from the labels shown. */
const codeSchema = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `请输入${label}`)
    .max(64, `${label}最多 64 个字符`)
    .regex(/^[a-z][a-z0-9_]*$/i, `${label}只能用字母、数字和下划线，以字母开头`);

const labelSchema = (label: string) =>
  z.string().trim().min(1, `请输入${label}`).max(64, `${label}最多 64 个字`);

/**
 * The dictionaries the code relies on, created for each tenant with these items the first time
 * it needs them. A tenant renames, reorders, disables and adds items, but can't delete them.
 * `permission`: what lets someone read the items, besides managing dictionaries.
 */
export const BUILTIN_DICTIONARIES = {
  'crm.customer-source': {
    name: '客户来源',
    permission: 'crm:customer',
    items: [
      { value: 'ONLINE', label: '线上' },
      { value: 'REFERRAL', label: '转介绍' },
      { value: 'EVENT', label: '活动' },
      { value: 'OUTBOUND', label: '主动开拓' },
      { value: 'OTHER', label: '其他' },
    ],
  },
} as const satisfies Record<
  string,
  { name: string; permission: PermissionCode; items: readonly { value: string; label: string }[] }
>;
export type BuiltinDictionaryCode = keyof typeof BUILTIN_DICTIONARIES;

export const dictionaryItemSchema = z.object({
  id: idSchema,
  /** What records store. */
  value: z.string(),
  label: z.string(),
  sort: z.number().int(),
  /** A disabled item is offered no more; records keep it and still show its label. */
  enabled: z.boolean(),
});
export type DictionaryItem = z.infer<typeof dictionaryItemSchema>;

export const dictionarySchema = z.object({
  id: idSchema,
  code: z.string(),
  name: z.string(),
  /** One of BUILTIN_DICTIONARIES: it can't be deleted, nor its code changed. */
  builtin: z.boolean(),
  items: z.array(dictionaryItemSchema),
  /** The custom fields offering its items. */
  usedBy: z.array(z.object({ entity: z.string(), label: z.string() })),
});
export type Dictionary = z.infer<typeof dictionarySchema>;

export const createDictionarySchema = z.object({
  code: codeSchema('编码'),
  name: labelSchema('名称'),
});
export type CreateDictionaryInput = z.infer<typeof createDictionarySchema>;

export const updateDictionarySchema = z.object({ name: labelSchema('名称') });
export type UpdateDictionaryInput = z.infer<typeof updateDictionarySchema>;

const sortSchema = z
  .number('请输入排序号')
  .int('排序号须为整数')
  .min(0, '排序号不能小于 0')
  .max(9999, '排序号不能大于 9999');

export const createDictionaryItemSchema = z.object({
  /** Left out, the item's id. */
  value: codeSchema('值').optional(),
  label: labelSchema('名称'),
  sort: sortSchema.default(0),
});
export type CreateDictionaryItemInput = z.infer<typeof createDictionaryItemSchema>;

export const updateDictionaryItemSchema = z
  .object({ label: labelSchema('名称'), sort: sortSchema, enabled: z.boolean() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, '至少修改一项');
export type UpdateDictionaryItemInput = z.infer<typeof updateDictionaryItemSchema>;

// Custom fields: fields a tenant adds to a model, stored in its `custom` column.

/**
 * The models a tenant can add fields to, each under the page permission that shows it. A model of
 * a module switched off for the tenant isn't offered.
 */
export const CUSTOM_FIELD_ENTITIES = {
  'crm.customer': { name: '客户', permission: 'crm:customer' },
  'crm.contact': { name: '联系人', permission: 'crm:contact' },
} as const satisfies Record<string, { name: string; permission: PermissionCode }>;
export type CustomFieldEntity = keyof typeof CUSTOM_FIELD_ENTITIES;
export const customFieldEntitySchema = z.enum(
  Object.keys(CUSTOM_FIELD_ENTITIES) as [CustomFieldEntity, ...CustomFieldEntity[]],
  '未知的模型',
);

export const CUSTOM_FIELD_TYPES = {
  TEXT: '单行文字',
  TEXTAREA: '多行文字',
  NUMBER: '数字',
  DATE: '日期',
  SELECT: '单选',
  MULTI_SELECT: '多选',
  BOOLEAN: '是/否',
} as const;
export type CustomFieldType = keyof typeof CUSTOM_FIELD_TYPES;
export const customFieldTypeSchema = z.enum(
  Object.keys(CUSTOM_FIELD_TYPES) as [CustomFieldType, ...CustomFieldType[]],
  '未知的字段类型',
);
export const isSelectType = (type: CustomFieldType) => type === 'SELECT' || type === 'MULTI_SELECT';

export const customFieldSchema = z.object({
  id: idSchema,
  entity: customFieldEntitySchema,
  /** Where records keep the value. */
  key: z.string(),
  label: z.string(),
  type: customFieldTypeSchema,
  required: z.boolean(),
  /** A column of the model's list. */
  showInList: z.boolean(),
  sort: z.number().int(),
  /** For select fields: the dictionary offering the options. */
  dictionary: z.object({ id: idSchema, name: z.string() }).nullable(),
  /** For select fields: the dictionary's items, disabled ones included to label old values. */
  options: z.array(dictionaryItemSchema),
});
export type CustomField = z.infer<typeof customFieldSchema>;

export const customFieldQuerySchema = z.object({ entity: customFieldEntitySchema });
export type CustomFieldQuery = z.infer<typeof customFieldQuerySchema>;

export const createCustomFieldSchema = z
  .object({
    entity: customFieldEntitySchema,
    key: codeSchema('字段标识'),
    label: labelSchema('字段名称'),
    type: customFieldTypeSchema,
    required: z.boolean().default(false),
    showInList: z.boolean().default(false),
    sort: sortSchema.default(0),
    dictionaryId: idSchema.nullable().default(null),
  })
  .refine((field) => !isSelectType(field.type) || field.dictionaryId !== null, {
    message: '单选和多选字段要选一个数据字典',
    path: ['dictionaryId'],
  });
export type CreateCustomFieldInput = z.infer<typeof createCustomFieldSchema>;

/** The key and type stay: records hold values under that key, of that type. */
export const updateCustomFieldSchema = z
  .object({
    label: labelSchema('字段名称'),
    required: z.boolean(),
    showInList: z.boolean(),
    sort: sortSchema,
    dictionaryId: idSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, '至少修改一项');
export type UpdateCustomFieldInput = z.infer<typeof updateCustomFieldSchema>;

/** A record's custom values, by field key. Checked against the fields when saved. */
export const customValuesSchema = z.record(z.string(), z.unknown());
export type CustomValues = Record<string, unknown>;

const TEXT_MAX = { TEXT: 200, TEXTAREA: 2000 } as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD of a day that exists: Date rolls 2026-02-30 over to March rather than refusing it. */
function isCalendarDate(value: string): boolean {
  const time = Date.parse(`${value}T00:00:00Z`);
  return DATE.test(value) && !Number.isNaN(time) && new Date(time).toISOString().startsWith(value);
}

/**
 * Why the value doesn't suit the field, or null. A select value must be an enabled option, unless
 * the record already had it (`stored`).
 */
export function customValueError(
  field: Pick<CustomField, 'label' | 'type' | 'options'>,
  value: unknown,
  stored?: unknown,
): string | null {
  const { label } = field;
  switch (field.type) {
    case 'TEXT':
    case 'TEXTAREA':
      if (typeof value !== 'string') return `${label}应为文字`;
      return value.length > TEXT_MAX[field.type]
        ? `${label}最多 ${TEXT_MAX[field.type]} 个字`
        : null;
    case 'NUMBER':
      return typeof value === 'number' && Number.isFinite(value) ? null : `${label}应为数字`;
    case 'DATE':
      return typeof value === 'string' && isCalendarDate(value) ? null : `${label}应为日期`;
    case 'BOOLEAN':
      return typeof value === 'boolean' ? null : `${label}应为是或否`;
    case 'SELECT':
    case 'MULTI_SELECT': {
      const values = field.type === 'SELECT' ? [value] : value;
      if (!Array.isArray(values) || values.some((item) => typeof item !== 'string')) {
        return `${label}的选项不对`;
      }
      const kept = new Set(Array.isArray(stored) ? stored : [stored]);
      const offered = new Set(
        field.options.filter((option) => option.enabled).map((option) => option.value),
      );
      return values.every((item) => offered.has(item as string) || kept.has(item))
        ? null
        : `${label}的选项不存在或已停用`;
    }
  }
}

/** A value that leaves the field empty: what required fields refuse. */
export const isEmptyCustomValue = (value: unknown) =>
  value === null ||
  value === undefined ||
  value === '' ||
  (Array.isArray(value) && value.length === 0);
