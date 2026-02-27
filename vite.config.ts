import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'apps/web',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'apps/web/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
