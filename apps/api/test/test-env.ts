import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dotenv from 'dotenv';

export const TEST_DATABASE = 'fld_asset_test';
export const TEST_BUCKET = 'fld-asset-test';

const S3_SETTINGS = [
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_FORCE_PATH_STYLE',
];

/**
 * The environment of the end-to-end tests: the Postgres server and Redis from compose.yaml (or
 * CI's DATABASE_URL and REDIS_URL), with a database and a Redis index of their own, so tests
 * never touch development data. Likewise the S3 server of S3_ENDPOINT, when set, with a bucket
 * of their own.
 */
export function testEnv() {
  const { parsed } = dotenv.config({ path: ['.env', '../../.env'], quiet: true, processEnv: {} });
  const env = { ...parsed, ...process.env };
  if (!env['DATABASE_URL'] || !env['REDIS_URL']) {
    throw new Error('Set DATABASE_URL and REDIS_URL, or copy .env.example to .env.');
  }
  const database = new URL(env['DATABASE_URL']);
  database.pathname = `/${TEST_DATABASE}`;
  const redis = new URL(env['REDIS_URL']);
  redis.pathname = '/1';
  return {
    NODE_ENV: 'test',
    DATABASE_URL: database.toString(),
    REDIS_URL: redis.toString(),
    // supertest keeps cookies over plain HTTP only when they aren't Secure.
    SESSION_COOKIE_SECURE: 'false',
    SUPER_ADMIN_USERNAME: 'superadmin',
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_DIR: join(tmpdir(), 'fld-asset-test-storage'),
    // Small, so that going over it takes a small upload.
    FILE_MAX_SIZE_MB: '1',
    // Every mail setting, so that none comes from a developer's .env. Nothing is sent: the tests
    // that mail put an outbox in place of the SMTP transport.
    SMTP_HOST: 'smtp.fld.test',
    SMTP_PORT: '2525',
    SMTP_SECURITY: 'none',
    SMTP_USERNAME: 'crm-mailer',
    SMTP_PASSWORD: 'env-smtp-password',
    MAIL_FROM_ADDRESS: 'crm@fld.test',
    MAIL_FROM_NAME: 'FLD CRM',
    SITE_URL: 'http://crm.fld.test',
    SETTINGS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    ...Object.fromEntries(S3_SETTINGS.flatMap((key) => (env[key] ? [[key, env[key]]] : []))),
    S3_BUCKET: TEST_BUCKET,
  };
}
