import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { instrument, peak } from './helpers';

// An iPhone-sized touch screen (Safari's user agent, so the iPhone install help shows).
test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});

const shown = (page: Page) =>
  page.locator('.workspace-layout > .pane').evaluateAll((ps) => ps.filter((p) => getComputedStyle(p).display !== 'none').map((p) => p.classList[1]));

async function demoNight(page: Page) {
  await instrument(page);
  await page.goto('/');
  await page.tap('.empty-state button:has-text("Try it with demo tracks")');
  await expect(page.locator('tr:has-text("Setcraft Demo")')).toHaveCount(3, { timeout: 20_000 });
  await page.tap('tr:has-text("Night Drive") button:has-text("+ Set")');
  await page.tap('tr:has-text("Warehouse Lights") button:has-text("+ Set")');
}

test('one panel at a time, picked from the tabs; everything fits the width', async ({ page }) => {
  await demoNight(page);
  expect(await shown(page)).toEqual(['library-pane']);
  for (const [tab, pane] of [
    ['Night', 'timeline-host'],
    ['Mix', 'transition-pane'],
    ['Deck', 'deck-pane'],
    ['Library', 'library-pane'],
  ]) {
    await page.tap(`.phone-tabs button:has-text("${tab}")`);
    expect(await shown(page)).toEqual([pane]);
  }
  // Nothing sideways: the page is exactly the screen's width, and the top bar's buttons are on screen.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  const importBox = (await page.locator('.topbar button.primary').boundingBox())!;
  expect(importBox.x + importBox.width).toBeLessThanOrEqual(390);
  // Export lives in the menu on a phone.
  await expect(page.locator('.export-btn')).toBeHidden();
  await page.tap('.menu-btn');
  await expect(page.locator('.menu-item:has-text("Export")')).toBeVisible();
});

test('opening a track from the library goes to the deck, and it plays', async ({ page }) => {
  await demoNight(page);
  await page.tap('tr:has-text("Night Drive") td:nth-child(3)');
  await expect(page.locator('.phone-tabs button.on')).toContainText('Deck');
  await expect(page.locator('button.play-btn')).toBeEnabled({ timeout: 20_000 });
  await page.tap('button.play-btn');
  await expect(page.locator('button.play-btn')).toHaveAttribute('aria-label', 'Pause');
  expect(await peak(page, 600)).toBeGreaterThan(0.02);
  // Switching tabs doesn't stop the music.
  await page.tap('.phone-tabs button:has-text("Night")');
  expect(await peak(page, 400)).toBeGreaterThan(0.02);
});

test('the night fits the screen, so the tracks can be grabbed and blended', async ({ page }) => {
  await demoNight(page);
  await page.tap('.phone-tabs button:has-text("Night")');
  const blocks = await page.locator('.tl-block').evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().width));
  // Fitted to what's planned (about 4½ minutes), not the hour-long target.
  expect(blocks[0]).toBeGreaterThan(120);
});

test('on an iPhone, Install app explains Add to Home Screen', async ({ page }) => {
  await instrument(page);
  await page.goto('/');
  await page.tap('.menu-btn');
  await page.tap('.menu-item:has-text("Install app")');
  await expect(page.getByRole('dialog', { name: 'Install Setcraft' })).toContainText('Add to Home Screen');
});

test('the tour shows each step on its own tab', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('keep-tour', '1'));
  await instrument(page);
  await page.goto('/');
  await page.tap('.tour-welcome button:has-text("Try it with demo tracks")');
  await expect(page.locator('.tour-card h3')).toHaveText('Your library', { timeout: 20_000 });
  expect(await shown(page)).toEqual(['library-pane']);
  await page.tap('tr:has-text("Night Drive") button:has-text("+ Set")');
  await page.tap('tr:has-text("Warehouse Lights") button:has-text("+ Set")');
  await expect(page.locator('.tour-card h3')).toHaveText('The journey of the night');
  expect(await shown(page)).toEqual(['timeline-host']);
  await page.locator('.tour-card button:has-text("Skip")').tap();
  await expect(page.locator('.tour-card h3')).toHaveText('Two decks, one transition');
  expect(await shown(page)).toEqual(['transition-pane']);
});

test('the app can be installed: manifest and icons', async ({ request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ name: 'Setcraft', display: 'standalone', start_url: './' });
  for (const icon of manifest.icons) expect((await request.get(`/${icon.src}`)).ok()).toBe(true);
  expect((await request.get('/sw.js')).ok()).toBe(true);
});

test('the import picker lets any file be chosen (Safari and iPhones grey out .nml and .crate otherwise)', async ({ page }) => {
  await instrument(page);
  await page.goto('/');
  const picker = page.locator('.topbar-right > input[type=file]:not([webkitdirectory])');
  expect(await picker.getAttribute('accept')).toBeNull();
  // A Traktor collection still imports from it.
  await picker.setInputFiles('src/core/__tests__/fixtures/traktor.nml');
  await expect(page.locator('tr:has-text("Warehouse")')).toHaveCount(1, { timeout: 15_000 });
});

test('songs added on the phone stay, are found by name wherever the collection says they were, and survive clearing the library', async ({ page }) => {
  await instrument(page);
  page.on('dialog', (d) => void d.accept());
  await page.goto('/');
  // Traktor says Warehouse lives on a USB stick; the phone's copy is renamed and numbered.
  await page.locator('.topbar-right > input[type=file]').first().setInputFiles('src/core/__tests__/fixtures/traktor.nml');
  await expect(page.locator('tr:has-text("Warehouse")')).toHaveCount(1, { timeout: 15_000 });
  const song = { name: '07_delta_-_warehouse.wav', mimeType: 'audio/wav', buffer: readFileSync('e2e/.audio/Music/Techno/Delta - Warehouse.wav') };

  // The library's playlists, music and Clear open from ☰ on a phone.
  await page.tap('.sources-toggle');
  await expect(page.locator('.sidebar.open')).toBeVisible();
  await expect(page.locator('.sidebar.open .side-item:has-text("Saturday")')).toBeVisible();
  await page.locator('.folder-panel .add-music + input').setInputFiles(song);
  await expect(page.locator('.toast').filter({ hasText: '1 song added to this phone' })).toContainText('1 track in your library now has its audio');
  await expect(page.locator('.device-music')).toContainText('1 song on this phone');
  await page.tap('.sidebar.open .side-item:has-text("Saturday")');
  await expect(page.locator('.sidebar.open')).toHaveCount(0);
  await expect(page.locator('.sources-toggle')).toContainText('Saturday');

  const playsWarehouse = async () => {
    await page.tap('tr:has-text("Warehouse") td:nth-child(3)');
    await expect(page.locator('button.play-btn')).toBeEnabled({ timeout: 20_000 });
    await page.tap('button.play-btn');
    expect(await peak(page, 500)).toBeGreaterThan(0.02);
    await page.tap('button.play-btn');
    await page.tap('.phone-tabs button:has-text("Library")');
  };
  await playsWarehouse();

  // Next visit: nothing to add again.
  await page.reload();
  await playsWarehouse();

  // Clearing is one step from the menu, and saves a version first.
  await page.tap('.menu-btn');
  await page.tap('.menu-item:has-text("Clear library")');
  await expect(page.locator('.empty-state')).toBeVisible();
  await page.tap('.menu-btn');
  await page.tap('.menu-item:has-text("Versions")');
  await expect(page.locator('.modal')).toContainText('Before clearing the library');
  await page.keyboard.press('Escape');

  // Imported again, the song kept on the phone is found for the new tracks.
  await page.locator('.topbar-right > input[type=file]').first().setInputFiles('src/core/__tests__/fixtures/traktor.nml');
  await expect(page.locator('tr:has-text("Warehouse")')).toHaveCount(1, { timeout: 15_000 });
  await playsWarehouse();
});
