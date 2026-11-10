import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

// Local development keeps one .env at the repo root; deployed containers receive real env vars.
dotenv.config({ path: ['.env', '../../.env'], quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
