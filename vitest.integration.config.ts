import { defineConfig } from 'vitest/config';

// Sobe um PostgreSQL de verdade (embutido, só para teste), aplica as migrações e roda os testes nele.
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['tests/integration/globalSetup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
