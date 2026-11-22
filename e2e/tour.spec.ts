import { expect, test, type Page } from '@playwright/test';
import { instrument } from './helpers';

const card = (page: Page) => page.locator('.tour-card');
const step = (page: Page, title: string) => expect(card(page).locator('h3')).toHaveText(title, { timeout: 20_000 });

test('a first visit gets the tour: demo tracks, then hands-on steps through the whole app', async ({ page }) => {
  // Like a first visit: no tour seen yet.
  await page.addInitScript(() => sessionStorage.setItem('keep-tour', '1'));
  await instrument(page);
  await page.goto('/');
  await expect(page.getByRole('dialog', { name: 'Welcome to Setcraft' })).toBeVisible();
  await page.click('.tour-welcome button:has-text("Try it with demo tracks")');

  // Demo tracks are in (with audio), so import and the music folder are passed over.
  await step(page, 'Your library');
  await expect(page.locator('tr:has-text("Setcraft Demo")')).toHaveCount(3);
  await expect(page.locator('.tour-spot')).toBeVisible();
  await page.click('tr:has-text("Night Drive") button:has-text("+ Set")');
  await page.click('tr:has-text("Warehouse Lights") button:has-text("+ Set")');

  await step(page, 'The journey of the night');
  const blocks = await page.locator('.tl-block').evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height })));
  await page.mouse.move(blocks[1].x + 10, blocks[1].y + blocks[1].h / 2);
  await page.mouse.down();
  await page.mouse.move(blocks[0].x + blocks[0].w - 14, blocks[1].y + blocks[1].h / 2, { steps: 8 });
  await page.mouse.up();

  await step(page, 'Two decks, one transition');
  await page.click('button.tv-preview');
  await step(page, 'How the two tracks meet');
  await card(page).locator('button:has-text("Next")').click();
  await step(page, 'Draw your own moves');
  await page.click('button.tv-keys');

  // Dragging the block opened that track, so the deck step is read-only: no "Try it", just Next.
  await step(page, 'The deck');
  await expect(card(page).locator('.tour-todo')).toHaveCount(0);
  await card(page).locator('button:has-text("Next")').click();
  await step(page, 'Hot cues');
  await page.locator('.pads .pad:not(.filled)').first().click();
  await step(page, 'The player');
  await expect(card(page).locator('.tour-todo')).toContainText('Press play');
  await page.click('button.play-btn');
  await step(page, 'Back to your DJ software');
  await card(page).locator('button:has-text("Finish")').click();
  await expect(page.getByRole('dialog', { name: 'Tour finished' })).toBeVisible();
  await page.click('button:has-text("Start playing")');
  await expect(page.locator('.tour-card, .tour-welcome')).toHaveCount(0);

  // Seen once: not again on the next visit, but it can be replayed from the menu.
  await page.reload();
  await page.waitForTimeout(800);
  await expect(page.locator('.tour-welcome')).toHaveCount(0);
  await page.click('.menu-btn');
  await page.click('.menu-item:has-text("Tutorial")');
  await expect(page.getByRole('dialog', { name: 'Welcome to Setcraft' })).toBeVisible();
  await page.click('button:has-text("Skip the tour")');
  await expect(page.locator('.tour-welcome')).toHaveCount(0);
});

test('with your own music, the tour starts at Import and Esc ends it', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('keep-tour', '1'));
  await instrument(page);
  await page.goto('/');
  await page.click('button:has-text("Use my own music")');
  await step(page, 'Bring in your library');
  await expect(card(page).locator('.tour-todo')).toContainText('Click Import');
  await page.keyboard.press('Escape');
  await expect(page.locator('.tour-card')).toHaveCount(0);
  // The empty library offers the demo tracks too.
  await expect(page.locator('.empty-state button:has-text("Try it with demo tracks")')).toBeVisible();
});
