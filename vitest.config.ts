import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const conwayCoreEntry = fileURLToPath(
  new URL('./packages/conway-core/index.ts', import.meta.url),
);
const rtsEngineEntry = fileURLToPath(
  new URL('./packages/rts-engine/index.ts', import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: {
      '#conway-core': conwayCoreEntry,
      '#rts-engine': rtsEngineEntry,
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // Keep the default include simple so `--root` can scope unit vs integration.
    include: ['**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '.planning/**',
      'conway-rts/**',
    ],
  },
});
