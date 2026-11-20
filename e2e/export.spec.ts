import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { makeBlend, openApp } from './helpers';

async function download(page: Page): Promise<string> {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.export button.primary.big')]);
  return readFileSync((await dl.path())!, 'utf8');
}

test("the night's mix points go into the export as memory cues", async ({ page }) => {
  await openApp(page);
  await makeBlend(page);
  await page.click('.topbar button:has-text("Export")');
  const option = page.locator('label.toggle:has-text("mix points")');
  await expect(option.locator('input')).toBeChecked();
  const xml = await download(page);
  const memory = [...xml.matchAll(/<POSITION_MARK Name="([^"]*)" Type="0" Start="[\d.]+" Num="-1"/g)].map((m) => m[1]);
  expect(memory).toEqual(expect.arrayContaining(['▸ Groove in (bass swap, ride to 120)', '◂ out → Groove', '◂ in from Warehouse', '⇅ bass swap']));
  await option.locator('input').uncheck();
  expect(await download(page)).not.toContain('bass swap');
});
