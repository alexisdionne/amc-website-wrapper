import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** GitHub Pages serves the site under /<repo>/, not at the domain root. */
const REPO_NAME = 'amc-website-wrapper';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: `/${REPO_NAME}/`,
  plugins: [react()],

  /**
   * data/ is served as static assets rather than imported. Importing
   * activities.json would inline 533 KB into the JS bundle and force a full
   * redownload every poll; as a public asset it stays separately cacheable
   * and is fetched at runtime.
   */
  publicDir: fileURLToPath(new URL('../data', import.meta.url)),

  build: {
    outDir: fileURLToPath(new URL('../dist', import.meta.url)),
    emptyOutDir: true,
  },
});
