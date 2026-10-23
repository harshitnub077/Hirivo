import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const legacyWorker = fileURLToPath(new URL('./node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url));

export default defineConfig({
  // Node can't load the browser build of pdf.js or a root-relative worker URL; the extension
  // build is unaffected (Vite emits the worker as an asset there).
  resolve: {
    alias: [
      { find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/legacy/build/pdf.mjs' },
      { find: /^pdfjs-dist\/build\/pdf\.worker\.min\.mjs\?url$/, replacement: fileURLToPath(new URL('./tests/pdfWorkerUrl.ts', import.meta.url)) },
    ],
  },
  define: { __PDF_WORKER__: JSON.stringify(legacyWorker) },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
});
