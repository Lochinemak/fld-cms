import { z } from 'zod';
import { optionalEmailSchema } from './account.js';
import { idSchema } from './id.js';
import { customValuesSchema } from './custom-fields.js';
import { pageQuerySchema, pageSchema } from './pagination.js';

/** Text a form may leave empty: blank reads as null, which also clears the field on update. */
function optionalText(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, `${label}最多 ${max} 个字`)
    .transform((value) => value || null)
    .nullable();
}

const optionalPhone = z
  .string()
  .trim()
  .max(32, '电话最多 32 位')
  .regex(/^[\d\s()+-]*$/, '电话只能包含数字、空格、+、- 和括号')
  .transform((value) => value || null)
  .nullable();

const changesSomething = (value: object) => Object.keys(value).length > 0;

/** A user as CRM records name them: the owner, the author. */
export const userRefSchema = z.object({ id: idSchema, displayName: z.string() });
export type UserRef = z.infer<typeof userRefSchema>;

const namedRefSchema = z.object({ id: idSchema, name: z.string() });

// Customers

export const customerStatusSchema = z.enum(['POTENTIAL', 'WON', 'LOST']);
export type CustomerStatus = z.infer<typeof customerStatusSchema>;

export const customerLevelSchema = z.enum(['A', 'B', 'C']);
export type CustomerLevel = z.infer<typeof customerLevelSchema>;

/** A value of the tenant's 客户来源 dictionary (crm.customer-source). */
export const customerSourceSchema = z.string().trim().min(1).max(64);
export type CustomerSource = z.infer<typeof customerSourceSchema>;

export const customerSchema = z.object({
  id: idSchema,
  name: z.string(),
  industry: z.string().nullable(),
  source: customerSourceSchema.nullable(),
  level: customerLevelSchema,
  status: customerStatusSchema,
  phone: z.string().nullable(),
  address: z.string().nullable(),
  remark: z.string().nullable(),
  owner: userRefSchema,
  /** The owner's department when the customer was created or last transferred; data scopes go by it. */
  dept: namedRefSchema.nullable(),
  creator: userRefSchema,
  /** Taken from the latest follow-up. */
  lastFollowUpAt: z.iso.datetime().nullable(),
  nextFollowUpAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** Values of the tenant's custom fields for customers, by key. */
  custom: customValuesSchema,
});
export type Customer = z.infer<typeof customerSchema>;

export const customerQuerySchema = pageQuerySchema.extend({
  status: customerStatusSchema.optional(),
  level: customerLevelSchema.optional(),
  /** Only the customers the user owns. */
  mine: z.stringbool().optional(),
  /** Only the customers whose next follow-up is due by then. */
  dueBy: z.iso.datetime({ offset: true }).optional(),
});
export type CustomerQuery = z.infer<typeof customerQuerySchema>;

const customerNameSchema = z
  .string()
  .trim()
  .min(1, '请输入客户名称')
  .max(128, '客户名称最多 128 个字');

const customerFieldsSchema = z.object({
  name: customerNameSchema,
  industry: optionalText(64, '行业'),
  source: customerSourceSchema.nullable(),
  level: customerLevelSchema,
  status: customerStatusSchema,
  phone: optionalPhone,
  address: optionalText(255, '地址'),
  remark: optionalText(1000, '备注'),
  /** Only the fields given change; null clears one. */
  custom: customValuesSchema,
});

/** The creator becomes the owner; hand the customer over afterwards with a transfer. */
export const createCustomerSchema = customerFieldsSchema.partial().extend({
  name: customerNameSchema,
  level: customerLevelSchema.default('B'),
  status: customerStatusSchema.default('POTENTIAL'),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = customerFieldsSchema
  .partial()
  .refine(changesSomething, '至少修改一项');
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const transferSchema = z.object({ ownerId: idSchema });
export type TransferInput = z.infer<typeof transferSchema>;

/** A member who may take over customers and opportunities. */
export const ownerOptionSchema = z.object({
  /** The user's id, which a transfer takes. */
  id: idSchema,
  displayName: z.string(),
  username: z.string(),
  dept: namedRefSchema.nullable(),
});
export type OwnerOption = z.infer<typeof ownerOptionSchema>;

export const ownerQuerySchema = z.object({
  keyword: z.string().trim().max(64).optional(),
});
export type OwnerQuery = z.infer<typeof ownerQuerySchema>;

// Contacts

export const contactSchema = z.object({
  id: idSchema,
  customer: namedRefSchema,
  name: z.string(),
  title: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  /** The customer's main contact; a customer has at most one. */
  primary: z.boolean(),
  remark: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** Values of the tenant's custom fields for contacts, by key. */
  custom: customValuesSchema,
});
export type Contact = z.infer<typeof contactSchema>;

export const contactQuerySchema = pageQuerySchema.extend({
  customerId: idSchema.optional(),
});
export type ContactQuery = z.infer<typeof contactQuerySchema>;

const contactNameSchema = z.string().trim().min(1, '请输入姓名').max(64, '姓名最多 64 个字');

const contactFieldsSchema = z.object({
  name: contactNameSchema,
  title: optionalText(64, '职务'),
  phone: optionalPhone,
  email: optionalEmailSchema,
  primary: z.boolean(),
  remark: optionalText(500, '备注'),
  /** Only the fields given change; null clears one. */
  custom: customValuesSchema,
});

export const createContactSchema = contactFieldsSchema.partial().extend({
  customerId: idSchema,
  name: contactNameSchema,
  primary: z.boolean().default(false),
});
export type CreateContactInput = z.infer<typeof createContactSchema>;

export const updateContactSchema = contactFieldsSchema
  .partial()
  .refine(changesSomething, '至少修改一项');
export type UpdateContactInput = z.infer<typeof updateContactSchema>;

// Follow-ups

export const followUpMethodSchema = z.enum([
  'CALL',
  'VISIT',
  'WECHAT',
  'EMAIL',
  'MEETING',
  'OTHER',
]);
export type FollowUpMethod = z.infer<typeof followUpMethodSchema>;

export const followUpSchema = z.object({
  id: idSchema,
  customer: namedRefSchema,
  contact: namedRefSchema.nullable(),
  opportunity: namedRefSchema.nullable(),
  method: followUpMethodSchema,
  content: z.string(),
  followedAt: z.iso.datetime(),
  nextAt: z.iso.datetime().nullable(),
  author: userRefSchema,
  createdAt: z.iso.datetime(),
});
export type FollowUp = z.infer<typeof followUpSchema>;

export const followUpQuerySchema = pageQuerySchema.extend({
  customerId: idSchema.optional(),
  opportunityId: idSchema.optional(),
  /** Only the follow-ups the user wrote. */
  mine: z.stringbool().optional(),
});
export type FollowUpQuery = z.infer<typeof followUpQuerySchema>;

// A minute of leeway for clocks that run slightly ahead of the server's.
const notInFuture = (value: string | undefined) =>
  value === undefined || Date.parse(value) <= Date.now() + 60_000;

export const createFollowUpSchema = z
  .object({
    customerId: idSchema,
    contactId: idSchema.optional(),
    opportunityId: idSchema.optional(),
    method: followUpMethodSchema,
    content: z.string().trim().min(1, '请填写跟进内容').max(2000, '跟进内容最多 2000 个字'),
    /** When it happened; now when left out. */
    followedAt: z.iso
      .datetime({ offset: true })
      .optional()
      .refine(notInFuture, '跟进时间不能晚于现在'),
    nextAt: z.iso.datetime({ offset: true }).optional(),
  })
  .refine(
    ({ followedAt, nextAt }) =>
      nextAt === undefined ||
      Date.parse(nextAt) > (followedAt ? Date.parse(followedAt) : Date.now()),
    { message: '下次跟进时间要晚于这次跟进', path: ['nextAt'] },
  );
export type CreateFollowUpInput = z.infer<typeof createFollowUpSchema>;

// Opportunities

export const opportunityStageSchema = z.enum([
  'QUALIFY',
  'NEEDS',
  'PROPOSAL',
  'NEGOTIATION',
  'WON',
  'LOST',
]);
export type OpportunityStage = z.infer<typeof opportunityStageSchema>;

/** Stages that end an opportunity; moving into one records when it closed. */
export const CLOSED_STAGES: readonly OpportunityStage[] = ['WON', 'LOST'];

/** Money as a decimal string with at most two places, e.g. "12000.5"; never a float. */
export const amountSchema = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, '金额须为数字，最多 12 位整数和 2 位小数');

export const opportunitySchema = z.object({
  id: idSchema,
  customer: namedRefSchema,
  name: z.string(),
  /** With two decimal places. */
  amount: z.string(),
  expectedCloseDate: z.iso.date().nullable(),
  stage: opportunityStageSchema,
  owner: userRefSchema,
  /** The owner's department when the opportunity was created or last transferred. */
  dept: namedRefSchema.nullable(),
  remark: z.string().nullable(),
  /** When it was won or lost. */
  closedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Opportunity = z.infer<typeof opportunitySchema>;

export const opportunityQuerySchema = pageQuerySchema.extend({
  stage: opportunityStageSchema.optional(),
  customerId: idSchema.optional(),
  /** Only the opportunities the user owns. */
  mine: z.stringbool().optional(),
});
export type OpportunityQuery = z.infer<typeof opportunityQuerySchema>;

export const stageSummarySchema = z.object({
  stage: opportunityStageSchema,
  count: z.number().int().nonnegative(),
  /** Total amount, with two decimal places. */
  amount: z.string(),
});
export type StageSummary = z.infer<typeof stageSummarySchema>;

export const opportunityPageSchema = pageSchema(opportunitySchema).extend({
  /** Every stage, with the count and total of the matching opportunities regardless of the stage filter. */
  stages: z.array(stageSummarySchema),
});
export type OpportunityPage = z.infer<typeof opportunityPageSchema>;

const opportunityNameSchema = z
  .string()
  .trim()
  .min(1, '请输入商机名称')
  .max(128, '商机名称最多 128 个字');

const opportunityFieldsSchema = z.object({
  name: opportunityNameSchema,
  amount: amountSchema,
  expectedCloseDate: z.iso.date('日期格式不正确').nullable(),
  stage: opportunityStageSchema,
  remark: optionalText(1000, '备注'),
});

/** The creator becomes the owner; hand the opportunity over afterwards with a transfer. */
export const createOpportunitySchema = opportunityFieldsSchema.partial().extend({
  customerId: idSchema,
  name: opportunityNameSchema,
  amount: amountSchema,
  stage: opportunityStageSchema.default('QUALIFY'),
});
export type CreateOpportunityInput = z.infer<typeof createOpportunitySchema>;

export const updateOpportunitySchema = opportunityFieldsSchema
  .partial()
  .refine(changesSomething, '至少修改一项');
export type UpdateOpportunityInput = z.infer<typeof updateOpportunitySchema>;
