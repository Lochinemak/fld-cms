import { randomInt, randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { RedisService } from '../redis/redis.service.js';
import { MAX_WORKER_ID, SnowflakeGenerator } from './snowflake.generator.js';

const LEASE_TTL_MS = 60_000;
const RENEW_INTERVAL_MS = 20_000;

const RENEW_SCRIPT = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) end return 0`;
const RELEASE_SCRIPT = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;

const leaseKey = (workerId: number) => `fld:snowflake:worker:${workerId}`;

/**
 * Hands out snowflake ids. Each instance leases a worker id in Redis, unless SNOWFLAKE_WORKER_ID
 * fixes one, and stops issuing ids once the lease has run out: another instance may hold it by then.
 */
@Injectable()
export class SnowflakeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SnowflakeService.name);
  private readonly owner = randomUUID();
  private generator?: SnowflakeGenerator;
  private leasedWorkerId?: number;
  private leaseExpiresAt = Number.POSITIVE_INFINITY;
  private renewTimer?: NodeJS.Timeout;

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onModuleInit() {
    const fixedWorkerId = this.config.get('SNOWFLAKE_WORKER_ID', { infer: true });
    if (fixedWorkerId !== undefined) {
      this.generator = new SnowflakeGenerator(fixedWorkerId);
      this.logger.log(`Snowflake worker id ${fixedWorkerId} (SNOWFLAKE_WORKER_ID)`);
      return;
    }
    this.generator = new SnowflakeGenerator(await this.lease(randomInt(MAX_WORKER_ID + 1)));
    this.renewTimer = setInterval(() => void this.renew(), RENEW_INTERVAL_MS);
    this.renewTimer.unref();
  }

  async onModuleDestroy() {
    clearInterval(this.renewTimer);
    if (this.leasedWorkerId !== undefined) {
      await this.redis
        .eval(RELEASE_SCRIPT, 1, leaseKey(this.leasedWorkerId), this.owner)
        .catch(() => undefined);
    }
  }

  next(): bigint {
    if (!this.generator) {
      throw new Error('SnowflakeService is not initialized yet');
    }
    if (Date.now() >= this.leaseExpiresAt) {
      throw new Error(`The lease on snowflake worker id ${this.leasedWorkerId} has expired`);
    }
    return this.generator.next();
  }

  private async lease(preferred: number): Promise<number> {
    for (let offset = 0; offset <= MAX_WORKER_ID; offset++) {
      const workerId = (preferred + offset) % (MAX_WORKER_ID + 1);
      const startedAt = Date.now();
      const result = await this.redis.set(leaseKey(workerId), this.owner, 'PX', LEASE_TTL_MS, 'NX');
      if (result === 'OK') {
        this.leasedWorkerId = workerId;
        this.leaseExpiresAt = startedAt + LEASE_TTL_MS;
        this.logger.log(`Leased snowflake worker id ${workerId}`);
        return workerId;
      }
    }
    throw new Error(`All ${MAX_WORKER_ID + 1} snowflake worker ids are leased`);
  }

  private async renew() {
    if (!this.generator) {
      return;
    }
    try {
      const workerId = this.leasedWorkerId;
      if (workerId !== undefined) {
        const startedAt = Date.now();
        const renewed = await this.redis.eval(
          RENEW_SCRIPT,
          1,
          leaseKey(workerId),
          this.owner,
          LEASE_TTL_MS,
        );
        if (renewed === 1) {
          this.leaseExpiresAt = startedAt + LEASE_TTL_MS;
          return;
        }
        this.logger.warn(`Lost the lease on snowflake worker id ${workerId}, leasing another`);
        this.leasedWorkerId = undefined;
        this.leaseExpiresAt = 0;
      }
      this.generator.workerId = await this.lease(workerId ?? randomInt(MAX_WORKER_ID + 1));
    } catch (error) {
      this.logger.error('Could not renew the snowflake worker id lease', error);
    }
  }
}
