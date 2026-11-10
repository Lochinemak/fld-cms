import { defineConfig } from 'vitest/config';
import { testEnv } from './test/test-env.js';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    env: testEnv(),
    globalSetup: ['./test/global-setup.ts'],
    // The files share one database and Redis index.
    fileParallelism: false,
    hookTimeout: 30_000,
  },
});
