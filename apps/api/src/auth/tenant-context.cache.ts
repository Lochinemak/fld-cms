import { createHash } from 'node:crypto';
import { PERMISSIONS } from '@fld/shared';
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';
import type { TenantContext } from './principal.js';

const TTL_SECONDS = 600;

// Built-in roles hold every permission in the registry, so a release that changes it must not
// serve contexts cached by the previous one.
const REGISTRY = createHash('sha256')
  .update(JSON.stringify(PERMISSIONS))
  .digest('hex')
  .slice(0, 12);

const versionKey = (tenantId: bigint) => `fld:tenant-ctx:ver:${tenantId}`;
const entryKey = (tenantId: bigint, version: string, userId: bigint) =>
  `fld:tenant-ctx:${REGISTRY}:${tenantId}:${version}:${userId}`;

/**
 * Caches each member's tenant context (permissions, data scope) per tenant version. Bumping the
 * version drops every entry of the tenant at once, so any change to its members, roles,
 * departments or status must call {@link invalidate}.
 */
@Injectable()
export class TenantContextCache {
  private readonly logger = new Logger(TenantContextCache.name);

  constructor(private readonly redis: RedisService) {}

  async getOrLoad(
    tenantId: bigint,
    userId: bigint,
    load: () => Promise<TenantContext | null>,
  ): Promise<TenantContext | null> {
    let key: string;
    try {
      key = entryKey(tenantId, (await this.redis.get(versionKey(tenantId))) ?? '0', userId);
      const cached = await this.redis.get(key);
      if (cached !== null) {
        return JSON.parse(cached) as TenantContext | null;
      }
    } catch (error) {
      this.logger.warn(`Tenant context cache unavailable, reading the database: ${String(error)}`);
      return load();
    }
    const context = await load();
    await this.redis.set(key, JSON.stringify(context), 'EX', TTL_SECONDS).catch(() => undefined);
    return context;
  }

  async invalidate(tenantId: bigint): Promise<void> {
    await this.redis.incr(versionKey(tenantId));
  }
}
