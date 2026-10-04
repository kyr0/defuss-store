import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', timeout: 20000, expect: { timeout: 5000 },
  fullyParallel: true, workers: 2, retries: 0,
  // VERIFIED: the defuss-vae gate fails unless e2e leaves fresh files in output/, so reports go there.
  outputDir: 'output/test-results',
  reporter: [['list'], ['json', { outputFile: 'output/browser-results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4178', headless: true,
    launchOptions: {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
      ...(process.env.PLAYWRIGHT_CHROMIUM_ARGS ? { args: JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS) as string[] } : {}),
    },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: { command: 'node --experimental-strip-types scripts/serve.ts', url: 'http://127.0.0.1:4178', timeout: 20000, reuseExistingServer: false },
});
