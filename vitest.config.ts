import { defineConfig } from 'vitest/config';

export default defineConfig({
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
