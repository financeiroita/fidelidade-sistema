import { defineConfig } from 'vitest/config';

// Testes rápidos (sem banco). Os de integração com PostgreSQL real: npm run test:integration.
export default defineConfig({ test: { exclude: ['node_modules/**', 'tests/integration/**'] } });
