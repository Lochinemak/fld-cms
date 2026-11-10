import { usernameSchema } from '@fld/shared';
import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  SWAGGER_ENABLED: z.stringbool().optional(),
  /** Turn off only when the app is served over plain HTTP on a host other than localhost. */
  SESSION_COOKIE_SECURE: z.stringbool().default(true),
  /** Comma-separated origins, besides the API's own, whose pages may call it with the session cookie. */
  TRUSTED_ORIGINS: z
    .string()
    .optional()
    .transform((value) =>
      (value ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  /**
   * Proxies in front of the API whose X-Forwarded-For to believe, in Express `trust proxy` form:
   * a hop count, addresses and subnets such as `loopback`, or `true`. Prefer the hop count:
   * `true`, or a subnet the clients themselves are in, lets a client pick its own address. Unset,
   * the connection's own address is the client's, which behind a proxy puts everyone under one
   * IP for rate limiting.
   */
  TRUST_PROXY: z
    .string()
    .trim()
    .optional()
    .transform((value): boolean | number | string => {
      if (!value || value === 'false') return false;
      if (value === 'true') return true;
      return /^\d+$/.test(value) ? Number(value) : value;
    }),
  /** Username of the super admin created with the system tenant on first start. */
  SUPER_ADMIN_USERNAME: usernameSchema.default('superadmin'),
  /** Fixes this instance's snowflake worker id (0–1023) instead of leasing one from Redis. */
  SNOWFLAKE_WORKER_ID: z.coerce.number().int().min(0).max(1023).optional(),
});

export type Env = z.infer<typeof envSchema>;
