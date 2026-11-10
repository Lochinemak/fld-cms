import { SYSTEM_TENANT_ID } from '@fld/shared';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PasswordHasher } from '@nestjs/authentication';
import { generatePassword } from '../common/password.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SnowflakeService } from '../snowflake/snowflake.service.js';
import { seedTenant } from './tenant-seed.js';

const SYSTEM_TENANT = BigInt(SYSTEM_TENANT_ID);
// Any constant works; it keeps instances starting together on an empty database from racing.
const BOOTSTRAP_LOCK = 0x666c645f626f6f74n;

/** On the first start against an empty database, creates the system tenant and its super admin. */
@Injectable()
export class SystemBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SystemBootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly snowflake: SnowflakeService,
    private readonly passwordHasher: PasswordHasher,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const exists = await this.prisma.tenant.count({ where: { id: SYSTEM_TENANT } });
    if (exists) {
      return;
    }
    const username = this.config.get('SUPER_ADMIN_USERNAME', { infer: true });
    const password = generatePassword();
    const passwordHash = await this.passwordHasher.hash(password);
    const nextId = () => this.snowflake.next();

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK})`;
      if (await tx.tenant.count({ where: { id: SYSTEM_TENANT } })) {
        return false;
      }
      const userId = nextId();
      await tx.user.create({
        data: {
          id: userId,
          username,
          displayName: '超级管理员',
          passwordHash,
          mustChangePassword: true,
        },
      });
      await seedTenant(tx, nextId, {
        id: SYSTEM_TENANT,
        code: 'system',
        name: '系统租户',
        adminRole: { code: 'super_admin', name: '超级管理员' },
        adminUserId: userId,
      });
      return true;
    });

    if (created) {
      this.logger.warn(
        `Created the system tenant and its super admin "${username}". ` +
          `Initial password (shown only this once, must be changed at first sign-in): ${password}`,
      );
    }
  }
}
