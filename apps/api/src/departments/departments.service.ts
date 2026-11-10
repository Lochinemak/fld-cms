import type { CreateDepartmentInput, Department, UpdateDepartmentInput } from '@fld/shared';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Principal } from '../auth/principal.js';
import { TenantContextCache } from '../auth/tenant-context.cache.js';
import { TENANT_PRISMA, tenantIdOf, type TenantPrisma } from '../authz/tenant-prisma.js';
import type { Prisma } from '../generated/prisma/client.js';
import { SnowflakeService } from '../snowflake/snowflake.service.js';

/** The width of departments.path, which holds the ids of every ancestor. */
const MAX_PATH_LENGTH = 1024;

const departmentSelect = {
  id: true,
  parentId: true,
  name: true,
  sort: true,
  _count: { select: { members: true } },
} satisfies Prisma.DepartmentSelect;

function toDepartment(
  row: Prisma.DepartmentGetPayload<{ select: typeof departmentSelect }>,
): Department {
  return {
    id: row.id.toString(),
    parentId: row.parentId?.toString() ?? null,
    name: row.name,
    sort: row.sort,
    memberCount: row._count.members,
  };
}

@Injectable()
export class DepartmentsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly snowflake: SnowflakeService,
    private readonly tenantContexts: TenantContextCache,
  ) {}

  /** Every department of the current tenant, siblings in display order. */
  async list(): Promise<Department[]> {
    const rows = await this.db.department.findMany({
      select: departmentSelect,
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toDepartment);
  }

  async create(user: Principal, input: CreateDepartmentInput): Promise<Department> {
    const parent = await this.find(input.parentId);
    if (!parent) {
      throw new BadRequestException('上级部门不存在');
    }
    const id = this.snowflake.next();
    const path = `${parent.path}${id}/`;
    if (path.length > MAX_PATH_LENGTH) {
      throw new BadRequestException('部门层级太深');
    }
    const row = await this.db.department.create({
      data: {
        id,
        tenantId: tenantIdOf(user),
        parentId: parent.id,
        name: input.name,
        sort: input.sort,
        path,
      },
      select: departmentSelect,
    });
    // Data scopes that cover the parent's subtree now cover this department too.
    await this.tenantContexts.invalidate(tenantIdOf(user));
    return toDepartment(row);
  }

  async update(user: Principal, id: string, input: UpdateDepartmentInput): Promise<Department> {
    const dept = await this.find(id);
    if (!dept) {
      throw new NotFoundException('部门不存在');
    }
    const fields = { name: input.name, sort: input.sort };
    if (input.parentId === undefined || input.parentId === dept.parentId?.toString()) {
      const row = await this.db.department.update({
        where: { id: dept.id },
        data: fields,
        select: departmentSelect,
      });
      return toDepartment(row);
    }

    if (dept.parentId === null) {
      throw new BadRequestException('根部门不能移动');
    }
    const parent = await this.find(input.parentId);
    if (!parent) {
      throw new BadRequestException('上级部门不存在');
    }
    if (parent.path.startsWith(dept.path)) {
      throw new BadRequestException('不能移到它自己或它的下级部门之下');
    }
    const path = `${parent.path}${dept.id}/`;
    if (path.length > MAX_PATH_LENGTH) {
      throw new BadRequestException('部门层级太深');
    }
    const tenantId = tenantIdOf(user);
    const row = await this.db.$transaction(async (tx) => {
      // The department and everything below it take the new parent's path as their prefix.
      await tx.$executeRaw`
        UPDATE departments
        SET path = ${path} || substr(path, length(${dept.path}) + 1)
        WHERE tenant_id = ${tenantId} AND path LIKE ${dept.path} || '%'`;
      return tx.department.update({
        where: { id: dept.id },
        data: { ...fields, parentId: parent.id },
        select: departmentSelect,
      });
    });
    // Data scopes over the old and the new parent's subtrees changed.
    await this.tenantContexts.invalidate(tenantId);
    return toDepartment(row);
  }

  async remove(user: Principal, id: string): Promise<void> {
    const dept = await this.find(id);
    if (!dept) {
      throw new NotFoundException('部门不存在');
    }
    if (dept.parentId === null) {
      throw new BadRequestException('根部门不能删除');
    }
    const [children, members] = await Promise.all([
      this.db.department.count({ where: { parentId: dept.id } }),
      this.db.tenantMember.count({ where: { deptId: dept.id } }),
    ]);
    if (children > 0) {
      throw new ConflictException('请先删除或移走它的下级部门');
    }
    if (members > 0) {
      throw new ConflictException('请先把部门里的成员调到其他部门');
    }
    await this.db.department.delete({ where: { id: dept.id } });
    // Custom data scopes that listed it no longer do.
    await this.tenantContexts.invalidate(tenantIdOf(user));
  }

  private find(id: string) {
    return this.db.department.findUnique({
      where: { id: BigInt(id) },
      select: { id: true, parentId: true, path: true },
    });
  }
}
