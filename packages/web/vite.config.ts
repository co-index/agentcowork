import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `pnpm dev` here + `pnpm host` at the root: the dev server proxies API calls to the hub.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:7420', changeOrigin: false },
    },
  },
});
