// Starts the built API for the web app's browser tests, on a database and Redis index of their
// own, both emptied first. On the empty database it creates the super admin and logs its initial
// password, which the tests read from this output.
//
// Run `pnpm build` first. Takes DATABASE_URL and REDIS_URL from the environment or the root .env.
import { spawn, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dotenv from 'dotenv';
import { Redis } from 'ioredis';
import pg from 'pg';

const UI_DATABASE = 'fld_asset_ui';
const PORT = process.env['UI_API_PORT'] ?? '3021';

const { parsed } = dotenv.config({ path: ['.env', '../../.env'], quiet: true, processEnv: {} });
const base = { ...parsed, ...process.env };
if (!base['DATABASE_URL'] || !base['REDIS_URL']) {
  throw new Error('Set DATABASE_URL and REDIS_URL, or copy .env.example to .env.');
}
const database = new URL(base['DATABASE_URL']);
database.pathname = `/${UI_DATABASE}`;
const redisUrl = new URL(base['REDIS_URL']);
redisUrl.pathname = '/2';

const env = {
  PATH: process.env['PATH'],
  NODE_ENV: 'test',
  PORT,
  DATABASE_URL: database.toString(),
  REDIS_URL: redisUrl.toString(),
  SESSION_COOKIE_SECURE: 'false',
  SUPER_ADMIN_USERNAME: 'superadmin',
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_DIR: join(tmpdir(), 'fld-asset-ui-storage'),
  // Set here rather than taken from a developer's .env, which the API reads too: the tests rely on
  // two-step sign-in being available, and on Logto being off.
  SETTINGS_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  LOGTO_AUTH_URL: '',
  LOGTO_APP_ID: '',
  LOGTO_APP_SECRET: '',
};

const server = new URL(database);
server.pathname = '/postgres';
const client = new pg.Client({ connectionString: server.toString() });
await client.connect();
try {
  await client.query(`DROP DATABASE IF EXISTS ${UI_DATABASE} WITH (FORCE)`);
  await client.query(`CREATE DATABASE ${UI_DATABASE}`);
} finally {
  await client.end();
}
execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { env, stdio: 'ignore' });
const redis = new Redis(env.REDIS_URL);
await redis.flushdb();
await redis.quit();

const api = spawn('node', ['dist/main.js'], { env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => api.kill(signal));
}
api.on('exit', (code) => process.exit(code ?? 0));
