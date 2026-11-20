import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// The Mac app (Electron), run from the built files: npm run desktop:build first (CI does).
const BUILT = existsSync('dist/index.html') && existsSync('desktop/build/main.mjs');
const MUSIC = resolve('e2e/.audio/Music');

let app: ElectronApplication;
let page: Page;
let home: string;
let collection: string;

test.beforeAll(async () => {
  test.skip(!BUILT, 'needs npm run desktop:build');
  const dir = mkdtempSync(join(tmpdir(), 'setcraft-desktop-'));
  home = join(dir, 'home');
  // A Traktor collection where the DJ software keeps it. Its Warehouse is on a USB stick that isn't
  // plugged in; the file is in the music folder instead.
  const traktor = join(home, 'Documents', 'Native Instruments', 'Traktor 4.1.0');
  mkdirSync(traktor, { recursive: true });
  collection = join(traktor, 'collection.nml');
  copyFileSync('src/core/__tests__/fixtures/traktor.nml', collection);
  app = await electron.launch({
    args: ['--no-sandbox', '.'],
    env: { ...process.env, SETCRAFT_USER_DATA: join(dir, 'data'), SETCRAFT_HOME: home, SETCRAFT_PORT: '47199' },
  });
  page = await app.firstWindow();
});
test.afterAll(async () => {
  await app?.close();
});

/** The next folder or file picker returns this, as if chosen. */
const willPick = (path: string) =>
  app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog;
  }, path);

test('first launch: add music folders, bring Traktor in (kept in sync), and every track plays from where it is', async () => {
  // Welcome: where is your music? Traktor's collection is found on its own.
  await expect(page.getByRole('heading', { name: 'Welcome to Setcraft' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.ms-lib')).toContainText('Traktor Pro 4.1.0');

  await willPick(MUSIC);
  await page.click('button:has-text("+ Add folder or drive")');
  await expect(page.locator('.ms-folders')).toContainText(MUSIC);
  await expect(page.locator('.ms-status')).toContainText('4 songs in your music folders', { timeout: 20_000 });

  // Import Traktor: its Warehouse is matched to the file in the music folder (one track, not two).
  await page.click('.ms-lib button:has-text("Import")');
  await expect(page.locator('.ms-lib')).toContainText('Kept in sync', { timeout: 15_000 });
  // Opening Theme's file is nowhere: it's the one missing.
  await expect(page.locator('.ms-status')).toContainText('1 tracks missing their file', { timeout: 15_000 });
  await page.click('button:has-text("Continue")');
  // Then the first-run tutorial offers itself (it waits until the music is set up): not now.
  await expect(page.locator('.tour-backdrop')).toBeVisible();
  await page.click('.tour-skip');
  await expect(page.locator('.tour-backdrop')).toHaveCount(0);
  await expect(page.locator('tr:has-text("Warehouse")')).toHaveCount(1);
  await expect(page.locator('tr:has-text("A440")')).toHaveCount(1);

  // Warehouse plays, straight from the music folder (Traktor said a USB stick).
  await page.click('tr:has-text("Warehouse") button.link');
  await expect(page.locator('button.play-btn')).toBeEnabled({ timeout: 30_000 });
  await page.click('button.play-btn');
  await expect(page.locator('button.play-btn')).toHaveAttribute('aria-label', 'Pause');
  await page.click('button.play-btn');
});

test('Traktor saves its collection: changes come in by themselves, with Undo', async () => {
  // A new hot cue on Warehouse, as if set in Traktor and saved.
  const nml = readFileSync(collection, 'utf8').replace(
    '<MUSICAL_KEY VALUE="5"></MUSICAL_KEY>',
    '<MUSICAL_KEY VALUE="5"></MUSICAL_KEY><CUE_V2 NAME="Drop" DISPL_ORDER="0" TYPE="0" START="45000.000000" LEN="0.000000" REPEATS="-1" HOTCUE="0"></CUE_V2>',
  );
  writeFileSync(collection, nml);
  const toast = page.locator('.toast').filter({ hasText: 'collection.nml changed' });
  await expect(toast).toContainText('1 updated', { timeout: 20_000 });
  await expect(page.locator('tr:has-text("Warehouse")')).toContainText('1 hot');
  await toast.locator('button:has-text("Undo")').click();
  await expect(page.locator('tr:has-text("Warehouse")')).toContainText('0 hot');
});

test('a missing file: Locate it once, and it plays', async () => {
  const moved = join(home, 'Moved', 'House');
  mkdirSync(moved, { recursive: true });
  const file = join(moved, 'DJ Alpha - Opening Theme.wav');
  copyFileSync(join(MUSIC, 'Latin', 'Steady - Groove.wav'), file);
  await page.click('.missing-btn');
  await expect(page.locator('.mf-list li')).toHaveCount(1);
  await expect(page.locator('.mf-list')).toContainText('Opening Theme');
  await willPick(file);
  await page.click('.mf-list button:has-text("Locate")');
  await expect(page.locator('.missing-files .modal-head')).toContainText('Every track has its file');
  await page.click('.missing-files button:has-text("Done")');
  await expect(page.locator('.missing-btn')).toHaveCount(0);
});
