import { defineConfig } from 'vite';

// Build for the downloadable single-file version (opens from a double-click, no server).
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist-offline',
    target: 'es2020',
    modulePreload: false,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 5000,
    rollupOptions: { output: { format: 'iife', inlineDynamicImports: true } },
  },
});
