import {
  SYSTEM_TENANT_ID,
  type CreateTenantInput,
  type CreateTenantResult,
  type Page,
  type PageQuery,
  type Tenant,
  type TenantAdminInput,
  type UpdateTenantInput,
} from '@fld/shared';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { normalizeAccount } from '../auth/account-name.js';
import { CredentialsService } from '../auth/credentials.service.js';
import { TenantContextCache } from '../auth/tenant-context.cache.js';
import { generatePassword } from '../common/password.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SnowflakeService } from '../snowflake/snowflake.service.js';
import { seedTenant } from './tenant-seed.js';

type NewTenantAdmin = Extract<TenantAdminInput, { mode: 'new' }>;

const tenantSelect = {
  id: true,
  code: true,
  name: true,
  status: true,
  createdAt: true,
  _count: { select: { members: true } },
} satisfies Prisma.TenantSelect;

function toTenant(row: Prisma.TenantGetPayload<{ select: typeof tenantSelect }>): Tenant {
  return {
    id: row.id.toString(),
    code: row.code,
    name: row.name,
    status: row.status,
    memberCount: row._count.members,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snowflake: SnowflakeService,
    private readonly credentials: CredentialsService,
    private readonly tenantContexts: TenantContextCache,
  ) {}

  async list({ page, pageSize, keyword }: PageQuery): Promise<Page<Tenant>> {
    const where: Prisma.TenantWhereInput = keyword
      ? {
          OR: [
            { code: { contains: keyword, mode: 'insensitive' } },
            { name: { contains: keyword, mode: 'insensitive' } },
          ],
        }
      : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.tenant.findMany({
        where,
        select: tenantSelect,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.tenant.count({ where }),
    ]);
    return { items: rows.map(toTenant), total };
  }

  /**
   * Creates a tenant administered by an existing account or a new one. A new account gets the
   * password given, or a generated one that the result returns this once; either way it must be
   * changed at first sign-in.
   */
  async create(input: CreateTenantInput): Promise<CreateTenantResult> {
    const nextId = () => this.snowflake.next();
    const tenantId = nextId();
    const admin =
      input.admin.mode === 'new'
        ? await this.prepareNewAdmin(input.admin, nextId())
        : { mode: 'existing' as const, account: normalizeAccount(input.admin.account) };

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (await tx.tenant.count({ where: { code: input.code } })) {
          throw new ConflictException('租户编码已被使用');
        }
        let adminUser: { id: bigint; username: string };
        if (admin.mode === 'new') {
          const { username, email } = admin.data;
          const taken = await tx.user.count({
            where: { OR: [{ username }, ...(email ? [{ email }] : [])] },
          });
          if (taken) {
            throw new ConflictException('用户名或邮箱已被使用');
          }
          adminUser = await tx.user.create({
            data: admin.data,
            select: { id: true, username: true },
          });
        } else {
          const found = await tx.user.findFirst({
            where: {
              OR: [{ username: admin.account }, { email: admin.account }],
              status: 'ACTIVE',
            },
            select: { id: true, username: true },
          });
          if (!found) {
            throw new BadRequestException('找不到该账号，或账号已停用');
          }
          adminUser = found;
        }
        await seedTenant(tx, nextId, {
          id: tenantId,
          code: input.code,
          name: input.name,
          adminRole: { code: 'tenant_admin', name: '租户管理员' },
          adminUserId: adminUser.id,
        });
        const tenant = await tx.tenant.findUniqueOrThrow({
          where: { id: tenantId },
          select: tenantSelect,
        });
        return {
          tenant: toTenant(tenant),
          admin: {
            id: adminUser.id.toString(),
            username: adminUser.username,
            ...(admin.mode === 'new' && admin.initialPassword
              ? { initialPassword: admin.initialPassword }
              : {}),
          },
        };
      });
    } catch (error) {
      // Two requests racing past the checks above.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('租户编码、用户名或邮箱已被使用');
      }
      throw error;
    }
  }

  private async prepareNewAdmin(admin: NewTenantAdmin, id: bigint) {
    const password = admin.password ?? generatePassword();
    return {
      mode: 'new' as const,
      initialPassword: admin.password ? undefined : password,
      data: {
        id,
        username: admin.username,
        email: admin.email ?? null,
        displayName: admin.displayName,
        passwordHash: await this.credentials.hash(password),
        mustChangePassword: true,
      } satisfies Prisma.UserUncheckedCreateInput,
    };
  }

  async update(id: string, input: UpdateTenantInput): Promise<Tenant> {
    if (id === SYSTEM_TENANT_ID && input.status === 'DISABLED') {
      throw new BadRequestException('系统租户不能停用');
    }
    const tenantId = BigInt(id);
    const { count } = await this.prisma.tenant.updateMany({ where: { id: tenantId }, data: input });
    if (count === 0) {
      throw new NotFoundException('租户不存在');
    }
    // Members of a disabled tenant lose access on their next request.
    await this.tenantContexts.invalidate(tenantId);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: tenantSelect,
    });
    return toTenant(tenant);
  }
}
