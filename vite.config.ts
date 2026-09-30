import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Browser tests (Playwright) live in e2e/ and run with `npm run e2e`.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
