import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

/** Which commit a build came from, shown in the ⋯ menu so any device can say what it's running. */
function buildId(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD__: JSON.stringify(`${buildId()} · ${new Date().toISOString().slice(0, 10)}`),
  },
  test: {
    environment: 'jsdom',
    // Browser tests (Playwright) live in e2e/ and run with `npm run e2e`.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
