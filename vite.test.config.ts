import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  mode: 'test',
  // Testes não herdam endpoints de produção do .env local.
  envDir: false,
  define: {
    'import.meta.env.VITE_GATEWAY_URL': JSON.stringify(''),
    'import.meta.env.VITE_APP_ENV': JSON.stringify('test')
  },
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
