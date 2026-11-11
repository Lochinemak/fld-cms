import type { RedisService } from '../redis/redis.service.js';

const LINKS_PER_HOUR = 5;

// The minute's marker first, then the hour's count. 1 when this link may go.
const ALLOW_LINK = `
if not redis.call('SET', KEYS[1], '1', 'EX', ARGV[1], 'NX') then
  return 0
end
local count = redis.call('INCR', KEYS[2])
if count == 1 then
  redis.call('EXPIRE', KEYS[2], ARGV[2])
end
if count > tonumber(ARGV[3]) then
  return 0
end
return 1
`;

/**
 * Whether another link of the kind may be mailed for the account: one a minute, and
 * LINKS_PER_HOUR an hour, so that nobody's mailbox fills up with them.
 */
export async function allowMailLink(
  redis: RedisService,
  kind: 'password-reset' | 'email-change',
  userId: bigint | string,
): Promise<boolean> {
  const allowed = await redis.eval(
    ALLOW_LINK,
    2,
    `fld:${kind}:minute:${userId}`,
    `fld:${kind}:hour:${userId}`,
    60,
    3600,
    LINKS_PER_HOUR,
  );
  return allowed === 1;
}
