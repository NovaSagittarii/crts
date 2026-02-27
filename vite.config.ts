import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: 'apps/web',
  resolve: {
    alias: {
      '#conway-core': path.resolve(__dirname, 'packages/conway-core/index.ts'),
      '#rts-engine': path.resolve(__dirname, 'packages/rts-engine/index.ts'),
    },
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'apps/web/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
