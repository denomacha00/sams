import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Point to types-only index — the utils (licenseKey, gps, attendance) use
      // Node.js crypto which cannot run in the browser. The frontend only needs
      // the shared type definitions and enums.
      '@sams/shared': path.resolve(__dirname, '../shared/src/types/index.ts'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        // Use VITE_API_PROXY_TARGET env var in dev, default to local backend
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
