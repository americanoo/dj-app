import { expect, test } from '@playwright/test';
import { makeBlend, openApp } from './helpers';

test('a synced bass-swap blend: the outgoing track rides into the incoming tempo, and the basses swap', async ({ page }) => {
  await openApp(page);
  await makeBlend(page);
  await expect(page.locator('.tv-blend select')).toHaveValue('bassSwap');
  await expect(page.locator('.tv-sync')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.tv-chips')).toContainText('Synced 130→120');
  await page.click('button.tv-preview');
  // Both decks playing: Warehouse held at 120/130 of its speed, Groove at its own; Groove's bass cut.
  await expect.poll(() => page.evaluate(() => window.__rates().length), { timeout: 20_000 }).toBe(2);
  const rates = await page.evaluate(() => window.__rates());
  expect(rates[0]).toBeCloseTo(120 / 130, 2);
  expect(rates[1]).toBeCloseTo(1, 3);
  expect(await page.evaluate(() => window.__lowShelves())).toEqual([0, -40]);
  // After the swap, the other way round.
  await expect.poll(() => page.evaluate(() => window.__lowShelves()), { timeout: 30_000 }).toEqual([-40, 0]);
});

test('dragging the incoming track snaps it onto the ridden beat', async ({ page }) => {
  await openApp(page);
  await makeBlend(page);
  const cv = (await page.locator('.tv-canvas').boundingBox())!;
  await page.mouse.move(cv.x + cv.width * 0.7, cv.y + cv.height * 0.75);
  await page.mouse.down();
  await page.mouse.move(cv.x + cv.width * 0.7 + 4, cv.y + cv.height * 0.75, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator('.tv-chips')).not.toContainText('beat off');
});

test('keyframes: a click adds a bump, fader or bass edits make the blend custom, and edits play live', async ({ page }) => {
  await openApp(page);
  await makeBlend(page);
  await page.click('button.tv-keys');
  const cv = (await page.locator('.tv-canvas').boundingBox())!;
  const rowB = (f: number) => cv.y + cv.height / 2 + 2 + (cv.height / 2 - 2) * f;
  await page.click('.tv-params button:has-text("Echo")');
  await page.mouse.click(cv.x + cv.width * 0.62, rowB(0.25));
  await expect(page.locator('.tv-params button:has-text("Echo") .tv-count')).toHaveText('3');
  await expect(page.locator('.tv-blend select')).toHaveValue('bassSwap');
  await page.click('.tv-params button:has-text("Bass")');
  await page.mouse.click(cv.x + cv.width * 0.45, cv.y + (cv.height / 2) * 0.3);
  await expect(page.locator('.tv-blend select')).toHaveValue('custom');
  // Loop it and pull the echo peak down while it plays: no voices are restarted.
  await page.click('button.tv-loop');
  await page.waitForTimeout(1500);
  const sourcesBefore = await page.evaluate(() => window.__sounding());
  await page.click('.tv-params button:has-text("Echo")');
  await page.mouse.move(cv.x + cv.width * 0.62, rowB(0.25));
  await page.mouse.down();
  await page.mouse.move(cv.x + cv.width * 0.62, rowB(0.98), { steps: 4 });
  await expect(page.locator('.tv-readout')).toContainText('Echo 0%');
  await page.mouse.up();
  expect(await page.evaluate(() => window.__sounding())).toBe(sourcesBefore);
  // Clear, then undo.
  await page.click('.tv-params button:has-text("Clear")');
  await expect(page.locator('.tv-blend select')).toHaveValue('bassSwap');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.tv-blend select')).toHaveValue('custom');
});
