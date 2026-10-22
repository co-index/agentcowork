import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

export default defineProject({
  // Test against workspace sources directly instead of built dist.
  resolve: {
    alias: {
      '@agentcowork/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  test: { name: 'server', include: ['test/**/*.test.ts'], testTimeout: 20_000 },
});
