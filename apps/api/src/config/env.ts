import { usernameSchema } from '@fld/shared';
import { z } from 'zod';

export const envSchema = z
  .object({
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
    /** Where uploaded files are kept: a local directory, or a bucket on an S3-compatible server. */
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    /** The local driver's directory, relative to the working directory unless absolute. */
    STORAGE_LOCAL_DIR: z.string().trim().min(1).default('storage'),
    /** Unset for AWS itself. */
    S3_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
    S3_REGION: z.string().trim().min(1).default('us-east-1'),
    S3_BUCKET: z.string().trim().min(1).optional(),
    /** Unset, the AWS SDK looks for credentials itself (AWS_* variables, an instance role…). */
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    /** Address buckets as `endpoint/bucket` rather than `bucket.endpoint`, as most self-hosted servers need. */
    S3_FORCE_PATH_STYLE: z.stringbool().default(false),
    /**
     * Downloads go straight from the S3 server through short-lived signed URLs. Turn off when
     * browsers can't reach S3_ENDPOINT, and the API streams them instead.
     */
    S3_SIGNED_DOWNLOADS: z.stringbool().default(true),
    /** The largest upload, in MB. The web image sizes nginx's request body limit from the same variable. */
    FILE_MAX_SIZE_MB: z.coerce.number().int().positive().default(100),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === 's3' && !env.S3_BUCKET) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_BUCKET'],
        message: 'Required when STORAGE_DRIVER is s3',
      });
    }
    if (!env.S3_ACCESS_KEY_ID !== !env.S3_SECRET_ACCESS_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_SECRET_ACCESS_KEY'],
        message: 'Set S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY together',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;
