import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5174,
    proxy: {
      '/admin/api': { target: 'http://localhost:2567', changeOrigin: true },
    },
  },
  build: { outDir: 'dist' },
});
