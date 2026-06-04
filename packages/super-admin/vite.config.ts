import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: '/',
  plugins: [react() as PluginOption],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Types only — utils use Node.js crypto which cannot run in the browser
      '@sams/shared': path.resolve(__dirname, '../shared/src/types/index.ts'),
    },
  },
  server: {
    port: 3002,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
