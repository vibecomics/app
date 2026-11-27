import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { googleDefines } from './scripts/build/read-env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default () => {
  return {
    // Relative asset URLs: the site works from any path (a GitHub Pages project
    // site, a custom domain, a sub-folder) without knowing where it is hosted.
    base: './',
    // Fixed and bound to every interface, so the dev server is reachable from outside the container/VM it runs in.
    server: { host: '0.0.0.0', port: 8080, strictPort: true, allowedHosts: true },
    plugins: [react()],
    // Injected as bare globals from the dotenv files; declared in src/globals.d.ts.
    define: googleDefines(),
    build: {
      // Two HTML entries: the root is a standalone static landing page (no React, no
      // bundle — see index.html itself); the app shell lives at app/index.html, so the
      // whole built app (its JS/CSS, its own sw.js) ends up under dist/app/.
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'index.html'),
          app: resolve(__dirname, 'app/index.html'),
        },
      },
    },
  };
};
