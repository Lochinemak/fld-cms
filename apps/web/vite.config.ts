import { resolve } from 'node:path';
import { DEFAULT_APP_NAME } from '@fld/shared';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // The router plugin must run before the React plugin.
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    {
      // index.html cannot import the default name, so it is written into its title here.
      name: 'app-name',
      transformIndexHtml: (html) => html.replace('%APP_NAME%', () => DEFAULT_APP_NAME),
    },
  ],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3011',
    },
  },
});
