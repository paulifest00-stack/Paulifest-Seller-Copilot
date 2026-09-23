import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/content-scripts/index.ts'),
      name: 'PaulifestContentScript',
      formats: ['iife'],
      fileName: () => 'content-script.js'
    }
  }
});
