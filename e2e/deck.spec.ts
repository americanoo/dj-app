import { expect, test } from '@playwright/test';
import { openApp, peak } from './helpers';

test('the deck plays the loaded track, and pauses', async ({ page }) => {
  await openApp(page);
  await page.click('button.play-btn');
  await expect(page.locator('button.play-btn')).toHaveAttribute('aria-label', 'Pause');
  expect(await peak(page, 600)).toBeGreaterThan(0.02);
  await page.click('button.play-btn');
  await page.waitForTimeout(200);
  expect(await peak(page, 300)).toBeLessThan(0.005);
});

test('a loop size from the loop group lands on the next free pad', async ({ page }) => {
  await openApp(page);
  const filled = page.locator('.pads .pad.filled');
  const before = await filled.count();
  await page.click('.seg button[title^="Loop 4 beats"]');
  await expect(filled).toHaveCount(before + 1);
});

test('Space plays the night even with no track on the deck', async ({ page }) => {
  await openApp(page);
  await page.reload();
  await expect(page.locator('.deck-empty')).toBeVisible();
  await page.click('.source-switch button:has-text("Night")');
  await page.keyboard.press('Space');
  await expect(page.locator('button.night-play')).toHaveText(/Pause night/);
  await page.keyboard.press('Space');
  await expect(page.locator('button.night-play')).toHaveText(/Play night/);
});
