import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist-test',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'tests/index.test.ts'),
      formats: ['es'],
      fileName: () => 'test.mjs'
    },
    rollupOptions: {
      external: [/^node:/, 'node:assert', 'node:test', 'node:crypto', 'node:http', 'node:buffer', 'node:url', 'pg']
    }
  }
});
