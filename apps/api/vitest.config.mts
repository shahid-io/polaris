import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The API's own tests arrive in Phase 2. Until then an empty suite is a valid
    // state, not a build failure. Vitest 4 exits non-zero on no-tests by default.
    passWithNoTests: true,
  },
});
