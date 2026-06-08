// Unit tests — pure functions, no database. Integration tests (*.integration.test.ts)
// are excluded here and run via vitest.integration.config.ts instead.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'node_modules/**'],
    environment: 'node',
  },
});
