import { defineConfig, devices } from '@playwright/test';

const API_PORT = 3021;
const WEB_PORT = 4183;

/**
 * Smoke tests in a real browser against the built app: the API on a database of its own, emptied
 * at start, and the web app's production build served by `vite preview`. Run `pnpm build` first.
 */
export default defineConfig({
  testDir: './e2e',
  // One flow, step by step: each test builds on what the one before left.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  // Never: a retry replays the story from its first step, on a database it already changed.
  retries: 0,
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    locale: 'zh-CN',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      name: 'api',
      command: 'node scripts/ui-test-server.mjs',
      cwd: '../api',
      env: { UI_API_PORT: String(API_PORT) },
      // The empty database gets a super admin, whose password only this log line gives.
      wait: { stdout: /Initial password[^:]*: (?<superadmin_password>\S+)/ },
      url: `http://localhost:${API_PORT}/api/health`,
      // Never someone's running API: the tests need the database it just emptied.
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      name: 'web',
      command: `pnpm exec vite preview --port ${WEB_PORT} --strictPort`,
      env: { API_PROXY_TARGET: `http://localhost:${API_PORT}` },
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
    },
  ],
});
