import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@sams/shared': path.resolve(__dirname, '../shared/src/types/index.ts'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'https://api.sams.ke',
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: process.env.VITE_API_PROXY_TARGET || 'https://api.sams.ke',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
