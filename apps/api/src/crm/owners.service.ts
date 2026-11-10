import type { OwnerOption, OwnerQuery } from '@fld/shared';
import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Principal } from '../auth/principal.js';
import { dataScopeWhere } from '../authz/data-scope.js';
import { TENANT_PRISMA, type TenantPrisma } from '../authz/tenant-prisma.js';
import type { Prisma } from '../generated/prisma/client.js';
import { toNamedRef } from './crm-scope.js';

const MAX_OPTIONS = 50;

const activeMember = {
  status: 'ACTIVE',
  user: { status: 'ACTIVE' },
} satisfies Prisma.TenantMemberWhereInput;

const ownerSelect = {
  userId: true,
  user: { select: { username: true, displayName: true } },
  department: { select: { id: true, name: true } },
} satisfies Prisma.TenantMemberSelect;

export interface NewOwner {
  userId: bigint;
  /** The department the record moves to. */
  deptId: bigint | null;
}

/**
 * Who customers and opportunities can be handed to: active members within the data scope of the
 * user handing them over, so nobody moves records outside the part of the tenant they can see.
 */
@Injectable()
export class OwnersService {
  constructor(@Inject(TENANT_PRISMA) private readonly db: TenantPrisma) {}

  async list(user: Principal, { keyword }: OwnerQuery): Promise<OwnerOption[]> {
    const filters: Prisma.TenantMemberWhereInput[] = [
      activeMember,
      dataScopeWhere<Prisma.TenantMemberWhereInput>(user, { dept: 'deptId', owner: 'userId' }),
    ];
    if (keyword) {
      const contains = { contains: keyword, mode: 'insensitive' } as const;
      filters.push({ user: { OR: [{ username: contains }, { displayName: contains }] } });
    }
    const rows = await this.db.tenantMember.findMany({
      where: { AND: filters },
      select: ownerSelect,
      orderBy: { id: 'asc' },
      take: MAX_OPTIONS,
    });
    return rows.map((row) => ({
      id: row.userId.toString(),
      displayName: row.user.displayName,
      username: row.user.username,
      dept: row.department && toNamedRef(row.department),
    }));
  }

  async resolve(user: Principal, ownerId: string): Promise<NewOwner> {
    const member = await this.db.tenantMember.findFirst({
      where: { ...activeMember, userId: BigInt(ownerId) },
      select: { userId: true, deptId: true },
    });
    if (!member) {
      throw new BadRequestException('新负责人须是本租户已启用的成员');
    }
    const scope = user.context?.dataScope;
    const covered =
      scope?.all ||
      (member.deptId !== null && scope?.deptIds.includes(member.deptId.toString())) ||
      (scope?.self && member.userId.toString() === user.id);
    if (!covered) {
      throw new ForbiddenException('只能转给你数据范围内的成员');
    }
    return member;
  }
}
