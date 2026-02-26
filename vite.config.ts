import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'public',
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'public/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
