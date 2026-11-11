import { z } from 'zod';
import { idSchema } from './id.js';
import { pageQuerySchema, pageSchema } from './pagination.js';

export const AUDIT_GROUPS = {
  security: '账号安全',
  organization: '组织与权限',
  platform: '平台管理',
  data: '业务数据',
} as const;
export type AuditGroup = keyof typeof AUDIT_GROUPS;

/**
 * What the audit log records: sign-ins and passwords, administration, and deleting or handing
 * over business data. Creating records and ordinary edits are not recorded.
 */
export const AUDIT_ACTIONS = {
  'auth.sign-in': { label: '登录', group: 'security' },
  'auth.sign-in-logto': { label: '通过 Logto 登录', group: 'security' },
  'auth.sign-out': { label: '退出登录', group: 'security' },
  'auth.switch-tenant': { label: '切换租户', group: 'security' },
  'auth.change-password': { label: '修改密码', group: 'security' },
  'auth.update-profile': { label: '修改个人资料', group: 'security' },
  'auth.request-email-change': { label: '申请修改邮箱', group: 'security' },
  'auth.forgot-password': { label: '申请重设密码', group: 'security' },
  'auth.reset-password': { label: '用邮件链接重设密码', group: 'security' },
  'auth.lock': { label: '账号被锁定', group: 'security' },

  'member.create': { label: '添加成员', group: 'organization' },
  'member.update': { label: '编辑成员', group: 'organization' },
  'member.remove': { label: '移出成员', group: 'organization' },
  'member.reset-password': { label: '重置成员密码', group: 'organization' },
  'member.unlock': { label: '解锁成员账号', group: 'organization' },
  'dept.create': { label: '新建部门', group: 'organization' },
  'dept.update': { label: '编辑部门', group: 'organization' },
  'dept.delete': { label: '删除部门', group: 'organization' },
  'role.create': { label: '新建角色', group: 'organization' },
  'role.update': { label: '编辑角色', group: 'organization' },
  'role.delete': { label: '删除角色', group: 'organization' },

  'tenant.create': { label: '新建租户', group: 'platform' },
  'tenant.update': { label: '编辑租户', group: 'platform' },
  'tenant.reset-admin': { label: '重设租户管理员', group: 'platform' },
  'account.reset-password': { label: '重置账号密码', group: 'platform' },
  'account.unlock': { label: '解锁账号', group: 'platform' },
  'settings.update': { label: '修改平台设置', group: 'platform' },
  'settings.test-mail': { label: '发送测试邮件', group: 'platform' },
  'mail-template.update': { label: '修改邮件模板', group: 'platform' },
  'mail-template.reset': { label: '恢复默认邮件模板', group: 'platform' },

  'customer.transfer': { label: '转移客户', group: 'data' },
  'customer.delete': { label: '删除客户', group: 'data' },
  'contact.delete': { label: '删除联系人', group: 'data' },
  'opportunity.transfer': { label: '转移商机', group: 'data' },
  'opportunity.delete': { label: '删除商机', group: 'data' },
  'follow-up.delete': { label: '删除跟进记录', group: 'data' },
  'folder.delete': { label: '删除文件夹', group: 'data' },
  'file.delete': { label: '删除文件', group: 'data' },
  'file.restore-version': { label: '恢复文件版本', group: 'data' },
  'file.share': { label: '创建分享链接', group: 'data' },
  'file.unshare': { label: '取消分享链接', group: 'data' },
} as const satisfies Record<string, { label: string; group: AuditGroup }>;

export type AuditAction = keyof typeof AUDIT_ACTIONS;
export const AUDIT_ACTION_CODES = Object.keys(AUDIT_ACTIONS) as AuditAction[];
export const auditActionSchema = z.enum(AUDIT_ACTION_CODES, '未知的操作');

export const AUDIT_TARGETS = {
  account: '账号',
  tenant: '租户',
  member: '成员',
  dept: '部门',
  role: '角色',
  settings: '平台设置',
  'mail-template': '邮件模板',
  customer: '客户',
  contact: '联系人',
  opportunity: '商机',
  'follow-up': '跟进记录',
  folder: '文件夹',
  file: '文件',
} as const;
export type AuditTargetType = keyof typeof AUDIT_TARGETS;
export const auditTargetTypeSchema = z.enum(Object.keys(AUDIT_TARGETS) as AuditTargetType[]);

/** One changed field, in words: what it was and what it became. */
export const auditChangeSchema = z.object({
  field: z.string(),
  /** Null where it had no value, or where only the new value means anything (a recipient). */
  from: z.string().nullable(),
  to: z.string().nullable(),
});
export type AuditChange = z.infer<typeof auditChangeSchema>;

/** Names are as they were at the time, so renaming or deleting later doesn't change the record. */
export const auditLogSchema = z.object({
  id: idSchema,
  createdAt: z.iso.datetime(),
  /** Who did it, or tried to: for a sign-in, the account it named. Null when unknown. */
  actor: z
    .object({ id: idSchema.nullable(), username: z.string(), displayName: z.string() })
    .nullable(),
  action: auditActionSchema,
  target: z
    .object({ type: auditTargetTypeSchema, id: idSchema.nullable(), name: z.string() })
    .nullable(),
  success: z.boolean(),
  /** Why it failed or did nothing. */
  reason: z.string().nullable(),
  changes: z.array(auditChangeSchema),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  /** Finds the request's lines in the API's log. */
  requestId: z.string().nullable(),
});
export type AuditLog = z.infer<typeof auditLogSchema>;

export const auditLogPageSchema = pageSchema(auditLogSchema);

/** `keyword` matches the object's name, `actor` the username or name of whoever did it. */
export const auditLogQuerySchema = pageQuerySchema.extend({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  actor: z.string().trim().max(64).optional(),
  action: auditActionSchema.optional(),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
