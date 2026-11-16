import {
  DEFAULT_TABLE_PREFERENCE,
  tablePreferenceSchema,
  type TableId,
  type TablePreference,
} from '@fld/shared';
import { Inject, Injectable } from '@nestjs/common';
import type { Principal } from '../auth/principal.js';
import { TENANT_PRISMA, tenantIdOf, type TenantPrisma } from '../authz/tenant-prisma.js';
import type { Prisma } from '../generated/prisma/client.js';
import { SnowflakeService } from '../snowflake/snowflake.service.js';

const tableKey = (table: TableId) => `table:${table}`;

/**
 * What each member set up for themselves in the current tenant, kept by key so that a browser on
 * any device shows it the same. Only the member reads and writes their own.
 */
@Injectable()
export class PreferencesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly snowflake: SnowflakeService,
  ) {}

  /** How the member likes the table; the default for one who never said, or said it oddly. */
  async table(user: Principal, table: TableId): Promise<TablePreference> {
    const row = await this.db.userPreference.findFirst({
      where: { userId: BigInt(user.id), key: tableKey(table) },
      select: { value: true },
    });
    const stored = tablePreferenceSchema.safeParse(row?.value);
    return stored.success ? stored.data : DEFAULT_TABLE_PREFERENCE;
  }

  async setTable(
    user: Principal,
    table: TableId,
    preference: TablePreference,
  ): Promise<TablePreference> {
    const tenantId = tenantIdOf(user);
    const userId = BigInt(user.id);
    const key = tableKey(table);
    const value = preference as Prisma.InputJsonObject;
    await this.db.userPreference.upsert({
      where: { tenantId_userId_key: { tenantId, userId, key } },
      create: { id: this.snowflake.next(), tenantId, userId, key, value },
      update: { value },
      select: { id: true },
    });
    return preference;
  }
}
