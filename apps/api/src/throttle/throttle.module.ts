import { minutes, normalizeIp, ThrottlerModule } from '@nestjs/throttler';
import { accountOf } from '../auth/account-name.js';
import { RedisService } from '../redis/redis.service.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

/**
 * Two limits, each request counting against both: `default` per IP address on every route, and
 * `account` per account and IP address wherever the request body names an account, so guessing
 * one account's password stays slow even for clients sharing an address with many others.
 */
export const ThrottleModule = ThrottlerModule.forRootAsync({
  inject: [RedisService],
  useFactory: (redis: RedisService) => ({
    storage: new RedisThrottlerStorage(redis),
    throttlers: [
      { name: 'default', ttl: minutes(1), limit: 300 },
      {
        name: 'account',
        ttl: minutes(15),
        limit: 5,
        skipIf: (context) => !accountOf(context.switchToHttp().getRequest()),
        getTracker: (req) => `${accountOf(req)}|${normalizeIp(String(req.ip))}`,
      },
    ],
  }),
});
