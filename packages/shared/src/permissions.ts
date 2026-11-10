/**
 * Permission registry: directory → page → element. Pages gate a screen and its read APIs,
 * elements gate one control (a button, a column, an action) and the API behind it.
 * Directories only group pages in menus and the role editor; they are never granted.
 */
export type PermissionKind = 'directory' | 'page' | 'element';

export interface PermissionDefinition {
  readonly name: string;
  readonly kind: PermissionKind;
  readonly parent?: string;
  /** Grantable in the system tenant, which grants nothing else. */
  readonly platform?: boolean;
}

export const PERMISSIONS = {
  system: { name: '系统管理', kind: 'directory' },

  'system:tenant': { name: '租户管理', kind: 'page', parent: 'system', platform: true },
  'system:tenant:create': {
    name: '新建租户',
    kind: 'element',
    parent: 'system:tenant',
    platform: true,
  },
  'system:tenant:update': {
    name: '编辑租户',
    kind: 'element',
    parent: 'system:tenant',
    platform: true,
  },

  'system:account': { name: '账号管理', kind: 'page', parent: 'system', platform: true },
  'system:account:reset-password': {
    name: '重置账号密码',
    kind: 'element',
    parent: 'system:account',
    platform: true,
  },

  'system:settings': { name: '平台设置', kind: 'page', parent: 'system', platform: true },
  'system:settings:update': {
    name: '修改平台设置',
    kind: 'element',
    parent: 'system:settings',
    platform: true,
  },

  'system:platform-audit': { name: '审计日志', kind: 'page', parent: 'system', platform: true },

  'system:member': { name: '成员管理', kind: 'page', parent: 'system' },
  'system:member:create': { name: '添加成员', kind: 'element', parent: 'system:member' },
  'system:member:update': { name: '编辑成员', kind: 'element', parent: 'system:member' },
  'system:member:remove': { name: '移出成员', kind: 'element', parent: 'system:member' },
  'system:member:reset-password': { name: '重置密码', kind: 'element', parent: 'system:member' },

  'system:dept': { name: '部门管理', kind: 'page', parent: 'system' },
  'system:dept:create': { name: '新建部门', kind: 'element', parent: 'system:dept' },
  'system:dept:update': { name: '编辑部门', kind: 'element', parent: 'system:dept' },
  'system:dept:delete': { name: '删除部门', kind: 'element', parent: 'system:dept' },

  'system:role': { name: '角色管理', kind: 'page', parent: 'system' },
  'system:role:create': { name: '新建角色', kind: 'element', parent: 'system:role' },
  'system:role:update': { name: '编辑角色', kind: 'element', parent: 'system:role' },
  'system:role:delete': { name: '删除角色', kind: 'element', parent: 'system:role' },

  'system:audit': { name: '审计日志', kind: 'page', parent: 'system' },

  crm: { name: '客户关系', kind: 'directory' },

  'crm:customer': { name: '客户', kind: 'page', parent: 'crm' },
  'crm:customer:create': { name: '新建客户', kind: 'element', parent: 'crm:customer' },
  'crm:customer:update': { name: '编辑客户', kind: 'element', parent: 'crm:customer' },
  'crm:customer:transfer': { name: '转移客户', kind: 'element', parent: 'crm:customer' },
  'crm:customer:delete': { name: '删除客户', kind: 'element', parent: 'crm:customer' },

  'crm:contact': { name: '联系人', kind: 'page', parent: 'crm' },
  'crm:contact:create': { name: '新建联系人', kind: 'element', parent: 'crm:contact' },
  'crm:contact:update': { name: '编辑联系人', kind: 'element', parent: 'crm:contact' },
  'crm:contact:delete': { name: '删除联系人', kind: 'element', parent: 'crm:contact' },

  'crm:follow-up': { name: '跟进记录', kind: 'page', parent: 'crm' },
  'crm:follow-up:create': { name: '写跟进', kind: 'element', parent: 'crm:follow-up' },
  'crm:follow-up:delete': { name: '删除跟进', kind: 'element', parent: 'crm:follow-up' },

  'crm:opportunity': { name: '商机', kind: 'page', parent: 'crm' },
  'crm:opportunity:create': { name: '新建商机', kind: 'element', parent: 'crm:opportunity' },
  'crm:opportunity:update': { name: '编辑商机', kind: 'element', parent: 'crm:opportunity' },
  'crm:opportunity:transfer': {
    name: '转移商机',
    kind: 'element',
    parent: 'crm:opportunity',
  },
  'crm:opportunity:delete': { name: '删除商机', kind: 'element', parent: 'crm:opportunity' },

  file: { name: '文件管理', kind: 'directory' },

  'file:library': { name: '文件', kind: 'page', parent: 'file' },
  'file:library:upload': { name: '上传', kind: 'element', parent: 'file:library' },
  'file:library:folder': { name: '新建文件夹', kind: 'element', parent: 'file:library' },
  'file:library:edit': { name: '重命名和移动', kind: 'element', parent: 'file:library' },
  'file:library:replace': { name: '替换和恢复版本', kind: 'element', parent: 'file:library' },
  'file:library:delete': { name: '删除', kind: 'element', parent: 'file:library' },
  'file:library:share': { name: '分享', kind: 'element', parent: 'file:library' },
} as const satisfies Record<string, PermissionDefinition>;

export type PermissionCode = keyof typeof PERMISSIONS;

export const PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

export function isPermissionCode(value: string): value is PermissionCode {
  return Object.hasOwn(PERMISSIONS, value);
}

export function permissionDefinition(code: PermissionCode): PermissionDefinition {
  return PERMISSIONS[code];
}

/**
 * The codes a role may hold in a tenant, never directories. The system tenant only manages
 * tenants: it holds the platform codes, which no other tenant may.
 */
export function grantablePermissions(isSystemTenant: boolean): PermissionCode[] {
  return PERMISSION_CODES.filter((code) => {
    const definition = permissionDefinition(code);
    return definition.kind !== 'directory' && (definition.platform === true) === isSystemTenant;
  });
}
