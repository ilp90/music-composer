import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/globalSetup.ts',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Synthetic camera + mic so compose/record flows run headless (M3+).
        launchOptions: {
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
        },
        permissions: ['camera', 'microphone'],
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @mc/api dev',
      url: 'http://localhost:3000/healthz',
      reuseExistingServer: !isCI,
    },
    {
      command: 'pnpm --filter @mc/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !isCI,
    },
  ],
});
