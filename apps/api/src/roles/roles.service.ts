import {
  grantablePermissions,
  type CreateRoleInput,
  type DataScope,
  type PermissionCode,
  type Role,
  type UpdateRoleInput,
} from '@fld/shared';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Principal } from '../auth/principal.js';
import { TenantContextCache } from '../auth/tenant-context.cache.js';
import { assertWithinOwnGrant } from '../authz/grants.js';
import { TENANT_PRISMA, tenantIdOf, type TenantPrisma } from '../authz/tenant-prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import { SnowflakeService } from '../snowflake/snowflake.service.js';

const roleSelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  builtin: true,
  dataScope: true,
  permissions: { select: { permission: true } },
  departments: { select: { deptId: true } },
  _count: { select: { members: true } },
} satisfies Prisma.RoleSelect;

type RoleRow = Prisma.RoleGetPayload<{ select: typeof roleSelect }>;

function grantableIn(user: Principal): Set<PermissionCode> {
  return new Set(grantablePermissions(user.context?.tenant.isSystem ?? false));
}

function toRole(row: RoleRow, grantable: Set<PermissionCode>): Role {
  const custom = !row.builtin && row.dataScope === 'CUSTOM';
  return {
    id: row.id.toString(),
    code: row.code,
    name: row.name,
    description: row.description,
    builtin: row.builtin,
    dataScope: row.builtin ? 'ALL' : row.dataScope,
    deptIds: custom ? row.departments.map(({ deptId }) => deptId.toString()) : [],
    // Built-in roles hold whatever the tenant may grant, however the registry grows.
    permissions: row.builtin
      ? [...grantable]
      : row.permissions
          .map(({ permission }) => permission)
          .filter((code): code is PermissionCode => grantable.has(code as PermissionCode)),
    memberCount: row._count.members,
  };
}

@Injectable()
export class RolesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly snowflake: SnowflakeService,
    private readonly tenantContexts: TenantContextCache,
  ) {}

  /** Every role of the current tenant, the built-in ones first. */
  async list(user: Principal): Promise<Role[]> {
    const rows = await this.db.role.findMany({
      select: roleSelect,
      orderBy: [{ builtin: 'desc' }, { id: 'asc' }],
    });
    const grantable = grantableIn(user);
    return rows.map((row) => toRole(row, grantable));
  }

  async create(user: Principal, input: CreateRoleInput): Promise<Role> {
    const permissions = this.checkGrantable(user, input.permissions);
    const deptIds = await this.checkScopeDepartments(input);
    assertWithinOwnGrant(user, { permissions, dataScope: input.dataScope, deptIds });
    const id = this.snowflake.next();
    try {
      await this.db.$transaction([
        this.db.role.create({
          data: {
            id,
            tenantId: tenantIdOf(user),
            code: input.code,
            name: input.name,
            description: input.description || null,
            dataScope: input.dataScope,
          },
        }),
        ...this.writeGrants(user, id, permissions, deptIds),
      ]);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('角色编码已被使用');
      }
      throw error;
    }
    return this.get(user, id);
  }

  async update(user: Principal, id: string, input: UpdateRoleInput): Promise<Role> {
    const role = await this.db.role.findUnique({ where: { id: BigInt(id) }, select: roleSelect });
    if (!role) {
      throw new NotFoundException('角色不存在');
    }
    if (role.builtin) {
      throw new BadRequestException('内置角色不能修改');
    }
    const permissions = this.checkGrantable(user, input.permissions);
    const deptIds = await this.checkScopeDepartments(input);

    // Only what the edit adds needs to be the editor's own to give.
    const heldPermissions = new Set<string>(role.permissions.map(({ permission }) => permission));
    const heldDepts = new Set(
      role.dataScope === 'CUSTOM' ? role.departments.map(({ deptId }) => deptId.toString()) : [],
    );
    const addedDepts = deptIds.filter((deptId) => !heldDepts.has(deptId));
    const scopeChanged = input.dataScope !== role.dataScope || addedDepts.length > 0;
    assertWithinOwnGrant(user, {
      permissions: permissions.filter((code) => !heldPermissions.has(code)),
      ...(scopeChanged ? { dataScope: input.dataScope, deptIds: addedDepts } : {}),
    });

    await this.db.$transaction([
      this.db.role.update({
        where: { id: role.id },
        data: {
          name: input.name,
          description: input.description || null,
          dataScope: input.dataScope,
        },
      }),
      ...this.writeGrants(user, role.id, permissions, deptIds),
    ]);
    await this.tenantContexts.invalidate(tenantIdOf(user));
    return this.get(user, role.id);
  }

  async remove(user: Principal, id: string): Promise<void> {
    const role = await this.db.role.findUnique({
      where: { id: BigInt(id) },
      select: { id: true, builtin: true },
    });
    if (!role) {
      throw new NotFoundException('角色不存在');
    }
    if (role.builtin) {
      throw new BadRequestException('内置角色不能删除');
    }
    await this.db.role.delete({ where: { id: role.id } });
    await this.tenantContexts.invalidate(tenantIdOf(user));
  }

  private async get(user: Principal, id: bigint): Promise<Role> {
    const row = await this.db.role.findUniqueOrThrow({ where: { id }, select: roleSelect });
    return toRole(row, grantableIn(user));
  }

  private checkGrantable(user: Principal, codes: PermissionCode[]): PermissionCode[] {
    const grantable = grantableIn(user);
    if (codes.some((code) => !grantable.has(code))) {
      throw new BadRequestException('包含本租户不能授予的权限');
    }
    return [...new Set(codes)];
  }

  /** The departments a CUSTOM scope lists, all of them the tenant's; none for other scopes. */
  private async checkScopeDepartments(input: {
    dataScope: DataScope;
    deptIds: string[];
  }): Promise<string[]> {
    if (input.dataScope !== 'CUSTOM') {
      return [];
    }
    const deptIds = [...new Set(input.deptIds)];
    const found = await this.db.department.count({
      where: { id: { in: deptIds.map((deptId) => BigInt(deptId)) } },
    });
    if (found !== deptIds.length) {
      throw new BadRequestException('所选部门不存在');
    }
    return deptIds;
  }

  /** Writes that make the role's permissions and custom departments exactly these. */
  private writeGrants(
    user: Principal,
    roleId: bigint,
    permissions: PermissionCode[],
    deptIds: string[],
  ) {
    const tenantId = tenantIdOf(user);
    return [
      this.db.rolePermission.deleteMany({ where: { roleId } }),
      this.db.roleDepartment.deleteMany({ where: { roleId } }),
      this.db.rolePermission.createMany({
        data: permissions.map((permission) => ({ roleId, permission })),
      }),
      this.db.roleDepartment.createMany({
        data: deptIds.map((deptId) => ({ tenantId, roleId, deptId: BigInt(deptId) })),
      }),
    ];
  }
}
