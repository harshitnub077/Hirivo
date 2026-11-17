// The public website (landing page, free tools, privacy policy). Static: no server, no analytics.
// npm run site:dev  → http://localhost:5200     npm run site:build → web-dist/
import { defineConfig } from 'vite';
import { resolve } from 'path';
import { sitePartials } from './web/build/partials';

const page = (name: string) => resolve(__dirname, 'web', name);

export default defineConfig({
  root: resolve(__dirname, 'web'),
  base: './',
  plugins: [sitePartials()],
  resolve: { alias: { '@': resolve(__dirname, './src') } },
  server: { port: 5200, fs: { allow: [__dirname] } },
  build: {
    outDir: resolve(__dirname, 'web-dist'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        index: page('index.html'),
        scam: page('scam-check.html'),
        keywords: page('keyword-match.html'),
        privacy: page('privacy.html'),
        notfound: page('404.html'),
      },
    },
  },
});
