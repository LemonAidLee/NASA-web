import { defineConfig } from 'vite';

// Rehearsal only. At the event: base: '/<repo>/' for GitHub Pages (plan 06 §8).
export default defineConfig({
  base: './',
  build: { target: 'es2023', chunkSizeWarningLimit: 2000 },
});
