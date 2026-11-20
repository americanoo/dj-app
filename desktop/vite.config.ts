import { defineConfig } from 'vite';

/** Bundles the Mac app's main process (desktop/main.ts and what it imports) into desktop/build/main.mjs. */
export default defineConfig({
  // The web app's public files belong to the web build (dist), not here.
  publicDir: false,
  build: {
    ssr: 'desktop/main.ts',
    outDir: 'desktop/build',
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: {
      external: ['electron', 'music-metadata'],
      output: { format: 'es', entryFileNames: 'main.mjs' },
    },
  },
});
