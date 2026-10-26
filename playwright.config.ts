import { readApplicationManifest, testPorts } from './scripts/e2e-app.mjs';
import { defineConfig, devices } from '@playwright/test';

const browserChannel = process.env.PLAYWRIGHT_CHANNEL;
const { app, development } = testPorts();
const nativeCase = readApplicationManifest().developmentCases[0];

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${app}`,
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  webServer: [
    {
      command: 'node scripts/e2e-app.mjs serve',
      url: `http://127.0.0.1:${app}`,
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command: 'node scripts/e2e-app.mjs dev',
      url: `http://127.0.0.1:${development}`,
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      testIgnore: nativeCase.file,
      use: {
        ...devices['Desktop Chrome'],
        ...(browserChannel ? { channel: browserChannel } : {}),
      },
    },
    {
      name: 'chromium-dev',
      testMatch: nativeCase.file,
      use: {
        ...devices['Desktop Chrome'],
        ...(browserChannel ? { channel: browserChannel } : {}),
        baseURL: `http://127.0.0.1:${development}`,
      },
    },
  ],
});
