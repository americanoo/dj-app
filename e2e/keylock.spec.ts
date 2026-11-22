import { expect, test, type Page } from '@playwright/test';
import { instrument } from './helpers';

/** Two pure tones in the night: A440 (120 BPM, Am) and B700 (132 BPM, Bbm), B coming in at 0:30 of A. */
async function tones(page: Page) {
  await instrument(page);
  await page.goto('/');
  await page.setInputFiles('.topbar-right > input[type=file]:not([webkitdirectory])', 'e2e/fixtures/tones.xml');
  await page.setInputFiles('.topbar-right input[webkitdirectory]', 'e2e/.audio/Music');
  await page.click('tr:has-text("A440") button:has-text("+ Set")');
  await page.click('tr:has-text("B700") button:has-text("+ Set")');
  await page.click('.sheet-btn');
  const mix = page.locator('.sheet-mix').first();
  await mix.locator('input.time-field').fill('0:30');
  await mix.locator('input.time-field').press('Enter');
  await expect(mix).toContainText('together');
  return mix;
}

const peak = (page: Page, lo: number, hi: number) => page.evaluate(([l, h]) => window.__peakHz(l, h), [lo, hi]);

test('key lock: a track ridden ×1.1 into the next tempo keeps its pitch; off, it rises like a record', async ({ page }) => {
  const mix = await tones(page);
  const lock = page.locator('.sheet-pane .keylock-btn');
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  // Plays from 0:22; A rides from 120 to 132 BPM over 0:14-0:30, then holds ×1.1.
  await mix.locator('button:has-text("Hear")').click();
  await page.waitForTimeout(9500);
  expect(Math.abs((await peak(page, 400, 560)) - 440)).toBeLessThan(6);
  // …while it really does play ×1.1 (the stretcher's place in the file against the night's clock).
  const speed = await page.evaluate(async () => {
    const n = (window as unknown as { __night: { position(): number; voices: Map<string, { stretch?: { inputTime: number } }> } }).__night;
    const v = [...n.voices.values()].find((x) => x.stretch)!;
    const [t0, i0] = [n.position(), v.stretch!.inputTime];
    await new Promise((r) => setTimeout(r, 2500));
    return (v.stretch!.inputTime - i0) / (n.position() - t0);
  });
  expect(speed).toBeGreaterThan(1.05);
  expect(speed).toBeLessThan(1.15);
  // Off: what's playing switches straight over, and A's 440 Hz comes out ×1.1.
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(1500);
  expect(Math.abs((await peak(page, 400, 560)) - 484)).toBeLessThan(6);
});

test('match key: the incoming track is transposed to mix with the one playing (Bbm → Am: a semitone down)', async ({ page }) => {
  const mix = await tones(page);
  await mix.locator('button:has-text("Match key")').click();
  await expect(page.locator('.sheet-track').nth(1).locator('.key-pill')).toHaveText('8A -1');
  await mix.locator('button:has-text("Hear")').click();
  await page.waitForTimeout(10500);
  // 700 Hz a semitone down: 660.7 Hz.
  expect(Math.abs((await peak(page, 600, 760)) - 660.7)).toBeLessThan(6);
  await mix.locator('button:has-text("Match key")').click();
  await page.waitForTimeout(1500);
  expect(Math.abs((await peak(page, 600, 760)) - 700)).toBeLessThan(6);
});
