import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: false },
      '/socket.io': {
        target: 'http://localhost:4000',
        ws: true,
        changeOrigin: false,
        configure: (proxy) => {
          // Abrupt socket closes (tab reload, server restart, kicked guest) are normal in dev.
          proxy.on('error', () => { });
          proxy.on('proxyReqWs', (_req, socket) => socket.on('error', () => { }));
        },
      },
    },
  },
  build: { sourcemap: false },
});