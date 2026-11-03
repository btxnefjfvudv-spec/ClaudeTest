import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages (/ClaudeTest/) and from any folder.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
});
