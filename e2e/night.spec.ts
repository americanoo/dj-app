import { expect, test } from '@playwright/test';
import { makeBlend, nightTime, openApp } from './helpers';

test('the night plays overlapping tracks together, and keeps playing while tracks are opened', async ({ page }) => {
  await openApp(page);
  await makeBlend(page);
  // The deck plays; starting the night stops it.
  await page.click('button.play-btn');
  await page.click('button.night-play');
  await expect(page.locator('button.night-play')).toHaveText(/Pause night/);
  await expect(page.locator('.source-switch button.on')).toHaveText('Night');
  expect(await page.evaluate(() => window.__sounding())).toBe(1);
  // Jump to just before Groove comes in and play into the blend.
  await page.click('button:has-text("Mix ▸")');
  const target = (await nightTime(page)) + 14;
  await expect.poll(() => nightTime(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(target);
  expect(await page.evaluate(() => window.__sounding())).toBe(2);
  await expect(page.locator('.tb-track b')).toHaveText(/Warehouse\s+⇄\s+Groove/);
  // Opening a track to edit its cues doesn't stop the music.
  await page.locator('.tl-block').first().click();
  await page.waitForTimeout(500);
  await expect(page.locator('button.night-play')).toHaveText(/Pause night/);
  expect(await page.evaluate(() => window.__sounding())).toBe(2);
});

test('the deck and the night share decoded audio', async ({ page }) => {
  await openApp(page);
  await page.waitForTimeout(1500);
  const afterAnalysis = await page.evaluate(() => window.__decodes);
  await page.click('button.play-btn');
  await page.waitForTimeout(500);
  await page.click('button.night-play');
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__decodes)).toBe(afterAnalysis);
});
