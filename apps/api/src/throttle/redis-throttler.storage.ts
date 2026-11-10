import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';

// Fixed window per key; once over the limit, the key stays blocked for blockDuration.
const INCREMENT_SCRIPT = `
local blocked = redis.call('PTTL', KEYS[2])
if blocked > 0 then
  return { tonumber(redis.call('GET', KEYS[1]) or ARGV[2]), redis.call('PTTL', KEYS[1]), 1, blocked }
end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  return { hits, ttl, 1, tonumber(ARGV[3]) }
end
return { hits, ttl, 0, 0 }
`;

/** Rate-limit counters in Redis, so every API instance counts against the same limits. */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ) {
    const prefix = `fld:throttle:${throttlerName}:${key}`;
    const [totalHits, timeToExpire, isBlocked, timeToBlockExpire] = (await this.redis.eval(
      INCREMENT_SCRIPT,
      2,
      `${prefix}:hits`,
      `${prefix}:blocked`,
      ttl,
      limit,
      blockDuration,
    )) as [number, number, number, number];
    return {
      totalHits,
      timeToExpire: Math.max(0, Math.ceil(timeToExpire / 1000)),
      isBlocked: isBlocked === 1,
      timeToBlockExpire: Math.max(0, Math.ceil(timeToBlockExpire / 1000)),
    };
  }
}
