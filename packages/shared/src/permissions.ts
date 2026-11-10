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
  /** Grantable only in the system tenant. */
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
} as const satisfies Record<string, PermissionDefinition>;

export type PermissionCode = keyof typeof PERMISSIONS;

export const PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

export function isPermissionCode(value: string): value is PermissionCode {
  return Object.hasOwn(PERMISSIONS, value);
}

export function permissionDefinition(code: PermissionCode): PermissionDefinition {
  return PERMISSIONS[code];
}

/** The codes a role may hold in a tenant: no directories, and platform codes only in the system tenant. */
export function grantablePermissions(isSystemTenant: boolean): PermissionCode[] {
  return PERMISSION_CODES.filter((code) => {
    const definition = permissionDefinition(code);
    return definition.kind !== 'directory' && (isSystemTenant || definition.platform !== true);
  });
}
