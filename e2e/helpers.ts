import { expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const NML = resolve('src/core/__tests__/fixtures/traktor.nml');
const STEADY = resolve('e2e/fixtures/steady.xml');
const MUSIC = resolve('e2e/.audio/Music');

declare global {
  interface Window {
    __level: () => number;
    __sounding: () => number;
    __rates: () => number[];
    __lowShelves: () => number[];
    __sends: () => number[];
    __decodes: number;
  }
}

/**
 * Taps everything that reaches the speakers, and keeps track of the audio graph
 * (playing sources, low-shelf EQs, echo sends, decodes) so tests can read it.
 * Also hides the folder picker so the <input webkitdirectory> fallback is used.
 */
async function instrument(page: Page) {
  await page.addInitScript(() => {
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    const w = window as unknown as Record<string, unknown>;
    let tap: AnalyserNode | null = null;
    let ctx: BaseAudioContext | null = null;
    const live = new Set<AudioBufferSourceNode>();
    const shelves: BiquadFilterNode[] = [];
    const sends: GainNode[] = [];
    w.__decodes = 0;
    const connect = AudioNode.prototype.connect as (this: AudioNode, d: AudioNode | AudioParam, ...r: number[]) => AudioNode;
    (AudioNode.prototype as unknown as { connect: typeof connect }).connect = function (this: AudioNode, dest: AudioNode | AudioParam, ...rest: number[]) {
      if (dest instanceof AudioDestinationNode) {
        ctx = dest.context;
        if (!tap) {
          tap = ctx.createAnalyser();
          tap.fftSize = 2048;
        }
        connect.call(this, tap);
      }
      if (this instanceof BiquadFilterNode && dest instanceof GainNode) (dest as unknown as { fb: boolean }).fb = true;
      if (this instanceof GainNode && dest instanceof DelayNode && !(this as unknown as { fb?: boolean }).fb) sends.push(this);
      return connect.call(this, dest, ...rest);
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when = 0, ...r: number[]) {
      const node = this as AudioBufferSourceNode & { from: number };
      node.from = when;
      live.add(node);
      node.addEventListener('ended', () => live.delete(node));
      return start.call(this, when, ...r);
    };
    const createFilter = BaseAudioContext.prototype.createBiquadFilter;
    BaseAudioContext.prototype.createBiquadFilter = function () {
      const f = createFilter.call(this);
      shelves.push(f);
      return f;
    };
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = function (...a: Parameters<typeof decode>) {
      (w.__decodes as number)++;
      return decode.apply(this, a);
    };
    const tracks = () =>
      [...live].filter((n) => ctx && (n as unknown as { from: number }).from <= ctx.currentTime && (n.buffer?.duration ?? 0) > 60);
    w.__level = () => {
      if (!tap) return 0;
      const a = new Float32Array(2048);
      tap.getFloatTimeDomainData(a);
      let s = 0;
      for (const v of a) s += v * v;
      return Math.sqrt(s / a.length);
    };
    w.__sounding = () => tracks().length;
    w.__rates = () => tracks().map((n) => n.playbackRate.value);
    w.__lowShelves = () => shelves.filter((f) => f.type === 'lowshelf').slice(-2).map((f) => f.gain.value);
    w.__sends = () => sends.slice(-2).map((g) => g.gain.value);
  });
}

/**
 * The app with a small library (Traktor + rekordbox imports), the synthetic
 * music folder linked, Warehouse → Groove in the night, and Warehouse on the deck.
 */
export async function openApp(page: Page) {
  await instrument(page);
  await page.goto('/');
  await page.setInputFiles('input[type=file][accept*=".xml"]', [NML, STEADY]);
  const merge = page.locator('.modal button.primary');
  if (await merge.count()) await merge.first().click();
  await page.setInputFiles('.topbar-right input[webkitdirectory]', MUSIC);
  await page.click('tr:has-text("Warehouse") button:has-text("+ Set")');
  await page.click('tr:has-text("Groove") button:has-text("+ Set")');
  await page.click('tr:has-text("Warehouse") button.link');
  await expect(page.locator('button.play-btn')).toBeEnabled({ timeout: 30_000 });
}

/** Drags Groove on the journey so it overlaps the end of Warehouse (a blend). */
export async function makeBlend(page: Page) {
  const blocks = await page.locator('.tl-block').evaluateAll((bs) =>
    bs.map((b) => {
      const r = b.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  );
  const [a, b] = blocks;
  await page.mouse.move(b.x + 20, b.y + b.h / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.w - 12 + 20, b.y + b.h / 2, { steps: 8 });
  await page.mouse.up();
  await page.locator('.tl-inspector button.icon').click();
}

/** Loudest level reaching the speakers over `ms`. */
export async function peak(page: Page, ms = 300): Promise<number> {
  let best = 0;
  const until = Date.now() + ms;
  while (Date.now() < until) {
    best = Math.max(best, await page.evaluate(() => window.__level()));
    await page.waitForTimeout(25);
  }
  return best;
}

/** Seconds into the night, from the journey's readout ("▶ 2:07"). */
export async function nightTime(page: Page): Promise<number> {
  const text = await page.locator('.tl-now').innerText();
  const [m, s] = text.replace(/[^\d:]/g, '').split(':').map(Number);
  return m * 60 + s;
}
