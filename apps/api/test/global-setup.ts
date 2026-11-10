import { execFileSync } from 'node:child_process';
import { Redis } from 'ioredis';
import pg from 'pg';
import { TEST_DATABASE, testEnv } from './test-env.js';

/** Recreates the test database from the migrations and empties the test Redis index. */
export default async function setup(): Promise<void> {
  const env = testEnv();
  const server = new URL(env.DATABASE_URL);
  server.pathname = '/postgres';
  const client = new pg.Client({ connectionString: server.toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${TEST_DATABASE} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${TEST_DATABASE}`);
  } finally {
    await client.end();
  }
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, ...env },
    stdio: 'pipe',
  });

  const redis = new Redis(env.REDIS_URL);
  try {
    await redis.flushdb();
  } finally {
    await redis.quit();
  }
}
