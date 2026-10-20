import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_BASE is set by the GitHub Pages workflow to "/<repo-name>/".
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
} as any);
