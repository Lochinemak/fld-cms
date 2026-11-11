import { Injectable } from '@nestjs/common';
import type { OidcStateStore, OidcTransaction } from '@nestjs/authentication';
import { RedisService } from '../redis/redis.service.js';

const key = (state: string) => `fld:oidc-state:${state}`;

/**
 * Sign-ins on their way to Logto and back, in Redis: they outlive a restart of the API, and any
 * instance can finish what another began. Each one expires by itself, which keeps them bounded.
 */
@Injectable()
export class RedisOidcStateStore implements OidcStateStore {
  constructor(private readonly redis: RedisService) {}

  async saveOidcState(transaction: OidcTransaction): Promise<void> {
    const ttl = Math.max(transaction.expiresAt.getTime() - Date.now(), 1);
    await this.redis.set(key(transaction.state), JSON.stringify(transaction), 'PX', ttl);
  }

  async consumeOidcState(state: string): Promise<OidcTransaction | undefined> {
    const stored = await this.redis.getdel(key(state));
    if (!stored) {
      return undefined;
    }
    const transaction = JSON.parse(stored) as OidcTransaction;
    return {
      ...transaction,
      createdAt: new Date(transaction.createdAt),
      expiresAt: new Date(transaction.expiresAt),
    };
  }
}
