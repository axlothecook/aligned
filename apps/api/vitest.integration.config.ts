// Integration tests — hit the real Express app + a REAL (test) Postgres database.
// Uses a setup file that points the app at a separate test DB, migrates it, and
// truncates tables between tests so they don't interfere.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    environment: 'node',
    globalSetup: ['src/test/global-setup.ts'],
    setupFiles: ['src/test/integration-setup.ts'],
    // DB tests share one connection/state → run serially, not in parallel.
    fileParallelism: false,
    hookTimeout: 30000,
  },
});
