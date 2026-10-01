import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node', globals: true,
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    testTimeout: 10000,
    coverage: { provider: 'v8', include: ['src/**/*.ts'], exclude: ['src/**/*.test.ts', 'src/**/*.bench.ts', 'src/bind/**', 'src/browser.ts', 'src/**/types.ts'], reporter: ['text', 'json-summary', 'lcov'] },
    benchmark: { include: ['src/**/*.bench.ts'] },
  },
});
