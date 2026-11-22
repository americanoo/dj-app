import { expect, test, type Page } from '@playwright/test';
import { instrument } from './helpers';

// The phone layout (src/ui/mobile), on an iPhone-sized touch screen.
test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});

type Entry = { trackId: string; fx?: { from: number; to?: number; tools: string[] }[]; stems?: { vocals: number; inst: number }[]; endFx?: string[]; matchKey?: boolean; tempo?: string };
type Track = { id: string; title: string; key?: string; bpm?: number; endFx?: string[]; cues: { kind: string; slot: number | null; start: number; end?: number; name: string }[] };

/** The saved project, as the app stores it. */
async function saved(page: Page): Promise<{ sets: { entries: Entry[] }[]; library: { tracks: Record<string, Track> } }> {
  return page.evaluate(
    () =>
      new Promise((done, fail) => {
        const open = indexedDB.open('keyval-store');
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction('keyval').objectStore('keyval').get('setcraft-project-v1');
          req.onerror = () => fail(req.error);
          req.onsuccess = () => {
            const p = req.result;
            const set = p?.sets.find((x: { id: string }) => x.id === p.activeSetId) ?? p?.sets[0];
            done({ ...p, sets: [set] });
          };
        };
      }),
  );
}
async function savedSoon<T>(page: Page, pick: (p: Awaited<ReturnType<typeof saved>>) => T): Promise<T> {
  let v: T | undefined;
  await expect
    .poll(async () => {
      try {
        v = pick(await saved(page));
        return v !== undefined && v !== false;
      } catch {
        return false;
      }
    }, { timeout: 10_000 })
    .toBe(true);
  return v!;
}

async function demoNight(page: Page) {
  await instrument(page);
  await page.goto('/');
  await page.tap('text=Or try the demo night');
  await expect(page.locator('.m-row')).toHaveCount(3, { timeout: 20_000 });
}

/** Tap the waveform of row `i` at a fraction of its width: the night goes there. */
async function seekRow(page: Page, i: number, frac: number) {
  const w = (await page.locator('.m-wave').nth(i).boundingBox())!;
  await page.touchscreen.tap(w.x + w.width * frac, w.y + 8);
}

async function holdPlus(page: Page) {
  const b = (await page.locator('.m-plus').boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
}

test('the phone layout: library and night as cards, nothing wider than the screen', async ({ page }) => {
  await instrument(page);
  await page.goto('/');
  await expect(page.locator('.m-app')).toBeVisible();
  await expect(page.locator('.m-head h1')).toHaveText('LOAD MUSIC');
  await page.tap('text=Or try the demo night');
  await expect(page.locator('.m-row')).toHaveCount(3, { timeout: 20_000 });
  // Clock rulers on both sides, one label per track plus the end.
  await expect(page.locator('.m-ruler.left .m-ruler-label')).toHaveCount(3);
  await expect(page.locator('.m-ruler-band')).toHaveCount(2); // the first row plays, on both rulers
  // Real times once the night has a start time.
  await page.locator('.m-head input[aria-label="start time"]').fill('23:00');
  await expect(page.locator('.m-ruler.left .m-ruler-label').first()).toHaveText('11:00');
  await page.tap('nav[aria-label=main] button[aria-label=library]');
  await expect(page.locator('.m-card')).toHaveCount(3);
  await expect(page.locator('.m-title').first()).toHaveCSS('font-family', /Anton/);
  for (const sel of ['.m-app', '.m-card', '.m-bar']) {
    const over = await page.locator(sel).evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().right > window.innerWidth + 0.5).length);
    expect(over, sel).toBe(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('library cards: key, BPM, start / end and end effects are typed in place; + adds to the night', async ({ page }) => {
  await demoNight(page);
  await page.tap('nav[aria-label=main] button[aria-label=library]');
  const card = page.locator('.m-card', { hasText: 'Sunrise' });
  await card.locator('input[aria-label=key]').fill('5A');
  await card.locator('input[aria-label=key]').press('Enter');
  await card.locator('input[aria-label=bpm]').fill('123');
  await card.locator('input[aria-label=bpm]').press('Enter');
  await card.locator('input[aria-label="start time"]').fill('16');
  await card.locator('input[aria-label="start time"]').press('Enter');
  await card.locator('input[aria-label="end time"]').fill('200');
  await card.locator('input[aria-label="end time"]').press('Enter');
  await card.locator('button[aria-label="kill lows at end time"]').tap();
  await expect(card.locator('input[aria-label="end time"]')).toHaveValue('02:00');
  const t = await savedSoon(page, (p) => Object.values(p.library.tracks).find((x) => x.title === 'Sunrise' && x.endFx?.length && x.cues.length >= 2));
  expect(t.bpm).toBe(123);
  expect(t.key).toBe('Cm');
  expect(t.endFx).toEqual(['killLows']);
  expect(t.cues.find((c) => c.name === 'Mix in')?.start).toBe(16);
  expect(t.cues.find((c) => c.name === 'Mix out')?.start).toBe(120);
  // In the night once more: its library start and end come along.
  await card.locator('button[aria-label^="add to night playlist"]').tap();
  await page.tap('nav[aria-label=main] button[aria-label=playlist]');
  await expect(page.locator('.m-row')).toHaveCount(4);
  const last = page.locator('.m-row').last();
  await expect(last.locator('input[aria-label="start time"]')).toHaveValue('00:16');
  await expect(last.locator('input[aria-label="end time"]')).toHaveValue('02:00');
  await expect(last.locator('button[aria-label="kill lows at end time"]')).toHaveAttribute('aria-pressed', 'true');
});

test('+ adds a start keyframe where the night is, its effects come from the tools bar, + again sets the end', async ({ page }) => {
  await demoNight(page);
  await seekRow(page, 0, 0.3);
  await page.tap('button[aria-label="add keyframe"]');
  await expect(page.locator('nav[aria-label="keyframe effects"]')).toBeVisible();
  await page.tap('button[aria-label="echo out"]');
  await page.tap('button[aria-label^="acapella / instrumental mode"]');
  await expect(page.locator('button[aria-label="acapella / instrumental mode: acapella"]')).toHaveAttribute('aria-pressed', 'true');
  await seekRow(page, 0, 0.5);
  await page.tap('button[aria-label="add end keyframe"]');
  await expect(page.locator('.m-wave').first()).toHaveAttribute('aria-label', 'waveform with keyframes at 2 points');
  const fx = await savedSoon(page, (p) => p.sets[0].entries[0].fx?.find((r) => r.to !== undefined && r.tools.length === 2));
  expect(fx.tools.sort()).toEqual(['acapella', 'echo']);
  expect(fx.to! - fx.from).toBeGreaterThan(10);
  // It's in the night the player plays.
  const plan = await page.evaluate(() => (window as unknown as { __night: { plan: { fx?: unknown[]; curves: { echo: unknown[] } }[] } }).__night.plan[0]);
  expect(plan.fx).toHaveLength(1);
  expect(plan.curves.echo.length).toBeGreaterThan(0);
  // Match key and sync are the track's own switches.
  await page.tap('button[aria-label="match key"]');
  await page.tap('button[aria-label="sync"]');
  const e = await savedSoon(page, (p) => p.sets[0].entries.find((x) => x.matchKey && x.tempo === 'free'));
  expect(e).toBeTruthy();
});

test('hold + to switch to hot cues (8 pads) or loops (in / out and sizes)', async ({ page }) => {
  await demoNight(page);
  await holdPlus(page);
  const menu = page.locator('[role=listbox][aria-label="hold plus to choose a function"]');
  await expect(menu).toBeVisible();
  await menu.locator('button:has-text("set hot cue 1")').tap();
  await expect(page.locator('nav[aria-label="hot cues"] .m-pad')).toHaveCount(8);
  await seekRow(page, 0, 0.2);
  await page.tap('button[aria-label="set hot cue 1"]');
  await seekRow(page, 0, 0.6);
  await page.tap('button[aria-label="set hot cue 2"]');
  await expect(page.locator('.m-pad').nth(1)).toHaveAttribute('aria-label', /hot cue 2 at \d:\d\d/);
  await expect(page.locator('.m-wave').first().locator('[data-cue]')).toHaveCount(2);
  // A pad jumps there.
  await page.locator('.m-pad').first().tap();
  const t = await page.evaluate(() => (window as unknown as { __night: { position(): number } }).__night.position());
  const cues = await savedSoon(page, (p) => Object.values(p.library.tracks).find((x) => x.cues.filter((c) => c.slot !== null).length === 2)?.cues);
  expect(Math.abs(t - cues.find((c) => c.slot === 0)!.start)).toBeLessThan(0.1);

  await holdPlus(page);
  await menu.locator('button:has-text("loop in / out")').tap();
  await expect(page.locator('nav[aria-label="loop length"]')).toBeVisible();
  await seekRow(page, 0, 0.5);
  await page.tap('button[aria-label="loop 4 bars"]');
  await expect(page.locator('button[aria-label="loop 4 bars"]')).toHaveAttribute('aria-pressed', 'true');
  const loop = await savedSoon(page, (p) => Object.values(p.library.tracks).flatMap((x) => x.cues.map((c) => ({ c, bpm: x.bpm }))).find(({ c }) => c.kind === 'loop'));
  expect(loop.c.end! - loop.c.start).toBeCloseTo((4 * 4 * 60) / loop.bpm!, 2);
  // Previewed: the night loops over it, until the loop bar goes.
  expect(await page.evaluate(() => (window as unknown as { __night: { loop: unknown } }).__night.loop)).not.toBeNull();
  await page.tap('button[aria-label="back to the main menu"]');
  await expect(page.locator('nav[aria-label=main]')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __night: { loop: unknown } }).__night.loop)).toBeNull();
});

test('the mixer: vocals / instrumental levels set keyframes where the night is', async ({ page }) => {
  await demoNight(page);
  await seekRow(page, 1, 0.4);
  await page.tap('button[aria-label=mixer]');
  await expect(page.locator('.m-sheet')).toContainText('Warehouse Lights');
  await page.tap('.m-sheet button:has-text("instrumental mode")');
  await expect(page.locator('.m-keys li')).toHaveCount(1);
  const stems = await savedSoon(page, (p) => p.sets[0].entries.find((e) => e.stems?.length)?.stems);
  expect(stems[0]).toMatchObject({ vocals: 0, inst: 1 });
});

test('drag a card by its handle to move it in the night', async ({ page }) => {
  await demoNight(page);
  const titles = () => page.locator('.m-row .m-title').allTextContents();
  const before = await titles();
  const h = (await page.locator('.m-handle').first().boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 + 130, { steps: 8 });
  await page.mouse.up();
  await expect.poll(titles).toEqual([before[1], before[0], before[2]]);
});

test('settings: classic layout is a tap away, and back', async ({ page }) => {
  await demoNight(page);
  await page.tap('nav[aria-label=main] button[aria-label=settings]');
  await page.tap('button[aria-label="blend every transition over 32 bars"]');
  await expect(page.locator('.toast').last()).toContainText('32 bars');
  await page.tap('button:has-text("classic layout")');
  await expect(page.locator('.phone-tabs')).toBeVisible();
  await page.tap('.topbar button:has-text("⋯")');
  await page.tap('.menu-item:has-text("Phone layout")');
  await expect(page.locator('.m-app')).toBeVisible();
});

test('the next track comes in over the end of the one before, from its start time, wherever the end is set', async ({ page }) => {
  await demoNight(page);
  type Slot = { startsAt: number; playFor: number; mixIn: number };
  const plan = () => page.evaluate(() => (window as unknown as { __night: { plan: Slot[] } }).__night.plan.map((s) => ({ startsAt: s.startsAt, playFor: s.playFor, mixIn: s.mixIn })));
  // The demo night blends: each track comes in before the one before it ends.
  let [a, b] = await plan();
  const overlap = a.startsAt + a.playFor - b.startsAt;
  expect(overlap).toBeGreaterThan(5);
  // An earlier end on the first track: the second comes in sooner, with the same overlap.
  const row = (i: number) => page.locator('.m-row').nth(i);
  await row(0).locator('input[aria-label="end time"]').fill('130');
  await row(0).locator('input[aria-label="end time"]').press('Enter');
  // A later start on the second: it plays from there.
  await row(1).locator('input[aria-label="start time"]').fill('20');
  await row(1).locator('input[aria-label="start time"]').press('Enter');
  await expect.poll(async () => (await plan())[1].mixIn).toBe(20);
  [a, b] = await plan();
  expect(a.playFor).toBeCloseTo(90, 1);
  expect(a.startsAt + a.playFor - b.startsAt).toBeCloseTo(overlap, 1);
  // Played across the blend: both sound together, then the second carries on.
  await page.evaluate((t) => (window as unknown as { __night: { play(t: number): void } }).__night.play(t), b.startsAt + 1);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __sounding(): number }).__sounding()), { timeout: 10_000 }).toBe(2);
  await page.evaluate((t) => (window as unknown as { __night: { play(t: number): void } }).__night.play(t), a.startsAt + a.playFor + 1);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __sounding(): number }).__sounding()), { timeout: 10_000 }).toBe(1);
});
