import dotenv from 'dotenv';

export const TEST_DATABASE = 'fld_asset_test';

/**
 * The environment of the end-to-end tests: the Postgres server and Redis from compose.yaml (or
 * CI's DATABASE_URL and REDIS_URL), with a database and a Redis index of their own, so tests
 * never touch development data.
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
  };
}
