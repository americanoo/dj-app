import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { instrument, peak } from './helpers';

// The Setcraft helper serving the built app (npm run build first; CI does).
const PORT = 5191;
let helper: ChildProcess | undefined;

test.beforeAll(async () => {
  test.skip(!existsSync('dist/index.html'), 'needs a build (npm run build)');
  helper = spawn(process.execPath, ['helper/setcraft-helper.mjs', '--port', String(PORT), '--music', 'e2e/.audio'], { stdio: 'pipe' });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('helper did not start')), 15_000);
    helper!.stdout!.on('data', (d: Buffer) => {
      if (d.toString().includes('helper is running')) {
        clearTimeout(timer);
        resolve();
      }
    });
    helper!.on('exit', (code) => reject(new Error(`helper exited (${code})`)));
  });
});
test.afterAll(() => {
  helper?.kill();
});

test('with the helper, imported tracks play straight from the computer: nothing to link or add', async ({ page }) => {
  await instrument(page);
  await page.goto(`http://localhost:${PORT}/`);
  // Traktor says Warehouse is on a USB stick that isn't here; the helper finds it by name in --music.
  await page.setInputFiles('.topbar-right > input[type=file]:not([webkitdirectory])', 'src/core/__tests__/fixtures/traktor.nml');
  await expect(page.locator('tr:has-text("Warehouse")')).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator('.helper-status.ok')).toContainText('Playing from');
  await page.click('tr:has-text("Warehouse") button.link');
  await expect(page.locator('button.play-btn')).toBeEnabled({ timeout: 20_000 });
  await page.click('button.play-btn');
  expect(await peak(page, 600)).toBeGreaterThan(0.02);
});
