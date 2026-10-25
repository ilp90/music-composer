import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Pre-bundle the compose view's heavy deps at server start, so Vite never has to discover them
  // on first visit and re-optimize/reload mid-session.
  optimizeDeps: { include: ['tone', '@mediapipe/tasks-vision'] },
  server: {
    port: 5173,
    strictPort: true,
    // Mirrors production, where CloudFront routes /api/* to the ALB and strips the prefix.
    proxy: {
      '/api': {
        target: API_URL,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
