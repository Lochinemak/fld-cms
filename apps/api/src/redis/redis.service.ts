import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Env } from '../config/env.js';

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor(config: ConfigService<Env, true>) {
    super(config.get('REDIS_URL', { infer: true }), { connectionName: 'fld-api' });
  }

  async onModuleDestroy() {
    await this.quit();
  }
}
