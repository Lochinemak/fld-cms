import {
  grantablePermissions,
  type CreateMemberInput,
  type CreateMemberResult,
  type Member,
  type MemberQuery,
  type Page,
  type ResetMemberPasswordResult,
  type UpdateMemberInput,
} from '@fld/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountProvisioning, type ProvisionedAccount } from '../auth/account-provisioning.js';
import { CredentialsService } from '../auth/credentials.service.js';
import type { Principal } from '../auth/principal.js';
import { TenantContextCache } from '../auth/tenant-context.cache.js';
import { dataScopeWhere } from '../authz/data-scope.js';
import { assertWithinOwnGrant, holdsBuiltinRole } from '../authz/grants.js';
import { TENANT_PRISMA, tenantIdOf, type TenantPrisma } from '../authz/tenant-prisma.js';
import { generatePassword } from '../common/password.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SnowflakeService } from '../snowflake/snowflake.service.js';

const memberSelect = {
  id: true,
  userId: true,
  status: true,
  createdAt: true,
  user: {
    select: {
      username: true,
      displayName: true,
      email: true,
      _count: { select: { memberships: true } },
    },
  },
  department: { select: { id: true, name: true } },
  roles: {
    select: { role: { select: { id: true, name: true, builtin: true } } },
    orderBy: { roleId: 'asc' },
  },
} satisfies Prisma.TenantMemberSelect;

function toMember(row: Prisma.TenantMemberGetPayload<{ select: typeof memberSelect }>): Member {
  return {
    id: row.id.toString(),
    userId: row.userId.toString(),
    username: row.user.username,
    displayName: row.user.displayName,
    email: row.user.email,
    status: row.status,
    dept: row.department ? { id: row.department.id.toString(), name: row.department.name } : null,
    roles: row.roles.map(({ role }) => ({
      id: role.id.toString(),
      name: role.name,
      builtin: role.builtin,
    })),
    sharedAccount: row.user._count.memberships > 1,
    joinedAt: row.createdAt.toISOString(),
  };
}

/**
 * Memberships of the current tenant. Every read and change stays within the user's data scope:
 * the members of the departments it covers, and the user's own membership.
 */
@Injectable()
export class MembersService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly prisma: PrismaService,
    private readonly snowflake: SnowflakeService,
    private readonly accounts: AccountProvisioning,
    private readonly credentials: CredentialsService,
    private readonly tenantContexts: TenantContextCache,
  ) {}

  async list(user: Principal, query: MemberQuery): Promise<Page<Member>> {
    const { page, pageSize, keyword, deptId, status } = query;
    const filters: Prisma.TenantMemberWhereInput[] = [this.visibleTo(user)];
    if (keyword) {
      const contains = { contains: keyword, mode: 'insensitive' } as const;
      filters.push({
        user: { OR: [{ username: contains }, { displayName: contains }, { email: contains }] },
      });
    }
    if (deptId) {
      const dept = await this.db.department.findUnique({
        where: { id: BigInt(deptId) },
        select: { path: true },
      });
      filters.push(dept ? { department: { path: { startsWith: dept.path } } } : { id: { in: [] } });
    }
    if (status) {
      filters.push({ status });
    }
    const where = { AND: filters };
    // Not in a transaction: Prisma loads the relations of the page concurrently, which on the one
    // connection of a transaction the pg driver has to queue (and warns it will stop doing).
    const [rows, total] = await Promise.all([
      this.db.tenantMember.findMany({
        where,
        select: memberSelect,
        orderBy: { id: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.tenantMember.count({ where }),
    ]);
    return { items: rows.map(toMember), total };
  }

  /**
   * Adds an existing account to the tenant, or creates a new one in it. A new account gets the
   * password given, or a generated one that the result returns this once.
   */
  async create(user: Principal, input: CreateMemberInput): Promise<CreateMemberResult> {
    const tenantId = tenantIdOf(user);
    await this.checkDepartment(user, input.deptId);
    const roleIds = await this.checkAssignable(user, input.roleIds, new Set());
    const account = await this.accounts.prepare(input.account);
    const memberId = this.snowflake.next();
    let provisioned: ProvisionedAccount;
    try {
      provisioned = await this.prisma.$transaction(async (tx) => {
        const found = await this.accounts.provision(tx, account);
        const joined = await tx.tenantMember.count({
          where: { tenantId, userId: found.id },
        });
        if (joined) {
          throw new ConflictException('该账号已是本租户的成员');
        }
        await tx.tenantMember.create({
          data: { id: memberId, tenantId, userId: found.id, deptId: BigInt(input.deptId) },
        });
        await tx.memberRole.createMany({
          data: roleIds.map((roleId) => ({ tenantId, memberId, roleId })),
        });
        return found;
      });
    } catch (error) {
      // Two requests racing past the checks above.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('该账号已是本租户的成员，或用户名、邮箱已被使用');
      }
      throw error;
    }
    // A context cached while the account was not a member would keep it out.
    await this.tenantContexts.invalidate(tenantId);
    const member = await this.get(memberId);
    return provisioned.initialPassword
      ? { member, initialPassword: provisioned.initialPassword }
      : { member };
  }

  async update(user: Principal, id: string, input: UpdateMemberInput): Promise<Member> {
    const member = await this.findManageable(user, id);
    const tenantId = tenantIdOf(user);
    if (input.deptId !== undefined) {
      await this.checkDepartment(user, input.deptId);
    }
    const roleIds =
      input.roleIds === undefined
        ? undefined
        : await this.checkAssignable(user, input.roleIds, member.roleIds);
    await this.db.$transaction([
      this.db.tenantMember.update({
        where: { id: member.id },
        data: {
          ...(input.deptId === undefined ? {} : { deptId: BigInt(input.deptId) }),
          ...(input.status === undefined ? {} : { status: input.status }),
        },
      }),
      ...(roleIds === undefined
        ? []
        : [
            this.db.memberRole.deleteMany({ where: { memberId: member.id } }),
            this.db.memberRole.createMany({
              data: roleIds.map((roleId) => ({ tenantId, memberId: member.id, roleId })),
            }),
          ]),
    ]);
    await this.tenantContexts.invalidate(tenantId);
    return this.get(member.id);
  }

  /** Takes the account out of the tenant; the account itself stays. */
  async remove(user: Principal, id: string): Promise<void> {
    const member = await this.findManageable(user, id);
    const tenantId = tenantIdOf(user);
    await this.db.$transaction([
      this.db.tenantMember.delete({ where: { id: member.id } }),
      // Their next sign-in lands in another tenant of theirs instead.
      this.db.user.updateMany({
        where: { id: member.userId, lastTenantId: tenantId },
        data: { lastTenantId: null },
      }),
    ]);
    await this.tenantContexts.invalidate(tenantId);
  }

  /**
   * Gives the account a generated password, which must be changed at the next sign-in, and signs
   * it out everywhere. Only for accounts of this tenant alone: otherwise one tenant's
   * administrator could take over an account that works in other tenants.
   */
  async resetPassword(user: Principal, id: string): Promise<ResetMemberPasswordResult> {
    const member = await this.findManageable(user, id);
    if (member.sharedAccount) {
      throw new ForbiddenException('该账号还属于其他租户，不能在这里重置密码');
    }
    const password = generatePassword();
    const passwordHash = await this.credentials.hash(password);
    await this.db.$transaction([
      this.db.user.update({
        where: { id: member.userId },
        data: { passwordHash, mustChangePassword: true },
      }),
      this.db.session.deleteMany({ where: { userId: member.userId.toString() } }),
    ]);
    return { password };
  }

  private visibleTo(user: Principal): Prisma.TenantMemberWhereInput {
    return dataScopeWhere<Prisma.TenantMemberWhereInput>(user, {
      dept: 'deptId',
      owner: 'userId',
    });
  }

  private async get(id: bigint): Promise<Member> {
    return toMember(
      await this.db.tenantMember.findUniqueOrThrow({ where: { id }, select: memberSelect }),
    );
  }

  /**
   * The member, if the user may manage it: within their data scope, not themselves, and holding
   * no administrator role unless the user holds one too.
   */
  private async findManageable(user: Principal, id: string) {
    const row = await this.db.tenantMember.findFirst({
      where: { AND: [{ id: BigInt(id) }, this.visibleTo(user)] },
      select: {
        id: true,
        userId: true,
        user: { select: { _count: { select: { memberships: true } } } },
        roles: { select: { roleId: true, role: { select: { builtin: true } } } },
      },
    });
    if (!row) {
      throw new NotFoundException('成员不存在');
    }
    if (row.userId.toString() === user.id) {
      throw new BadRequestException('不能在这里修改自己的成员信息');
    }
    if (row.roles.some(({ role }) => role.builtin) && !(await holdsBuiltinRole(this.db, user))) {
      throw new ForbiddenException('只有管理员才能修改其他管理员');
    }
    return {
      id: row.id,
      userId: row.userId,
      sharedAccount: row.user._count.memberships > 1,
      roleIds: new Set(row.roles.map(({ roleId }) => roleId.toString())),
    };
  }

  /** The department must be the tenant's and, unless the user sees every row, one they see. */
  private async checkDepartment(user: Principal, deptId: string): Promise<void> {
    if (!(await this.db.department.count({ where: { id: BigInt(deptId) } }))) {
      throw new BadRequestException('部门不存在');
    }
    const scope = user.context?.dataScope;
    if (!scope?.all && !scope?.deptIds.includes(deptId)) {
      throw new ForbiddenException('只能把成员放到你的数据范围内的部门');
    }
  }

  /**
   * The roles' ids, after checking each is the tenant's and each newly assigned one hands out
   * nothing beyond the user's own grant.
   */
  private async checkAssignable(
    user: Principal,
    roleIds: string[],
    held: ReadonlySet<string>,
  ): Promise<bigint[]> {
    const ids = [...new Set(roleIds)];
    const roles = await this.db.role.findMany({
      where: { id: { in: ids.map((roleId) => BigInt(roleId)) } },
      select: {
        id: true,
        builtin: true,
        dataScope: true,
        permissions: { select: { permission: true } },
        departments: { select: { deptId: true } },
      },
    });
    if (roles.length !== ids.length) {
      throw new BadRequestException('所选角色不存在');
    }
    const added = roles.filter((role) => !held.has(role.id.toString()));
    if (added.some((role) => role.builtin) && !(await holdsBuiltinRole(this.db, user))) {
      throw new ForbiddenException('只有管理员才能分配管理员角色');
    }
    const grantable = new Set<string>(grantablePermissions(user.context?.tenant.isSystem ?? false));
    for (const role of added) {
      if (!role.builtin) {
        assertWithinOwnGrant(user, {
          permissions: role.permissions
            .map(({ permission }) => permission)
            .filter((code) => grantable.has(code)),
          dataScope: role.dataScope,
          deptIds: role.departments.map(({ deptId }) => deptId.toString()),
        });
      }
    }
    return roles.map((role) => role.id);
  }
}
