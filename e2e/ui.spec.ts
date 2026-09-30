import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

test('controls are borderless, and anything switched on is inverted', async ({ page }) => {
  await openApp(page);
  const borders = await page.locator('button:visible').evaluateAll((bs) =>
    bs.filter((b) => getComputedStyle(b).borderTopWidth !== '0px').map((b) => b.textContent?.trim()),
  );
  expect(borders).toEqual([]);
  const on = await page.locator('.snap-control button.on').first().evaluate((b) => getComputedStyle(b).backgroundColor);
  expect(on).toBe('rgb(236, 235, 244)');
});

test('the ⋯ menu holds the less-used actions', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('.menu-pop')).toBeHidden();
  await page.click('.menu-btn');
  await expect(page.locator('.menu-pop')).toBeVisible();
  await expect(page.locator('.menu-item')).toContainText(['Story & chapters', 'Controller', 'Versions']);
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu-pop')).toBeHidden();
  await page.click('.menu-btn');
  await page.click('.menu-item:has-text("Story")');
  await expect(page.locator('.modal')).toBeVisible();
});
