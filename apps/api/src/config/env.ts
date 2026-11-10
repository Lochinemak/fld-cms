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
  /** Username of the super admin created with the system tenant on first start. */
  SUPER_ADMIN_USERNAME: usernameSchema.default('superadmin'),
  /** Fixes this instance's snowflake worker id (0–1023) instead of leasing one from Redis. */
  SNOWFLAKE_WORKER_ID: z.coerce.number().int().min(0).max(1023).optional(),
});

export type Env = z.infer<typeof envSchema>;
