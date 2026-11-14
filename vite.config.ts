import { defineConfig } from 'vite';

// Relative base: the same build works on Vercel, GitHub Pages or any static host (plan 06 §8).
export default defineConfig({
  base: './',
  build: { target: 'es2023', chunkSizeWarningLimit: 2000 },
});
