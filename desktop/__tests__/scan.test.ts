// @vitest-environment node
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findLibraries } from '../libraries';
import { fingerprint, scanFolders } from '../scan';

const dir = mkdtempSync(join(tmpdir(), 'setcraft-scan-'));
const music = join(dir, 'Music');
mkdirSync(join(music, 'House'), { recursive: true });
mkdirSync(join(music, '_Serato_'), { recursive: true });
mkdirSync(join(music, '.hidden'), { recursive: true });
writeFileSync(join(music, 'House', 'DJ Alpha - Opening Theme.mp3'), Buffer.alloc(200_000, 1));
writeFileSync(join(music, 'House', 'cover.jpg'), 'x');
writeFileSync(join(music, '_Serato_', 'db.mp3'), 'x');
writeFileSync(join(music, '.hidden', 'secret.mp3'), 'x');
writeFileSync(join(music, 'Delta - Warehouse.wav'), Buffer.alloc(1000, 2));

describe('scanning music folders', () => {
  it('finds every audio file (not hidden or DJ-software folders), with its tags and a fingerprint', async () => {
    let reads = 0;
    const tags = async (p: string) => (reads++, p.endsWith('.wav') ? { title: 'Warehouse', artist: 'Delta', bpm: 130 } : {});
    const progress: number[] = [];
    const { entries, cache } = await scanFolders([music], {}, tags, (p) => progress.push(p.done));
    expect(entries.map((e) => e.path.slice(music.length)).sort()).toEqual(['/Delta - Warehouse.wav', '/House/DJ Alpha - Opening Theme.mp3']);
    expect(entries.find((e) => e.path.endsWith('.wav'))).toMatchObject({ title: 'Warehouse', bpm: 130, size: 1000 });
    expect(entries.every((e) => /^[0-9a-f]{24}$/.test(e.fileId))).toBe(true);
    expect(progress.at(-1)).toBe(2);
    expect(reads).toBe(2);

    // A rescan only reads files that changed.
    const wav = join(music, 'Delta - Warehouse.wav');
    utimesSync(wav, new Date(), new Date(Date.now() + 5000));
    await scanFolders([music], cache, tags);
    expect(reads).toBe(3);
  });

  it('fingerprints follow the content, not the name or place', async () => {
    const a = join(dir, 'a.mp3');
    const b = join(dir, 'b.mp3');
    writeFileSync(a, Buffer.alloc(300_000, 7));
    writeFileSync(b, Buffer.alloc(300_000, 7));
    expect(await fingerprint(a, 300_000)).toBe(await fingerprint(b, 300_000));
    writeFileSync(b, Buffer.alloc(300_000, 8));
    expect(await fingerprint(a, 300_000)).not.toBe(await fingerprint(b, 300_000));
  });
});

describe('finding DJ-software libraries', () => {
  it("finds Traktor's collection.nml, newest first", async () => {
    const home = join(dir, 'home');
    for (const v of ['Traktor 3.11.1', 'Traktor 4.1.0']) {
      mkdirSync(join(home, 'Documents', 'Native Instruments', v), { recursive: true });
      writeFileSync(join(home, 'Documents', 'Native Instruments', v, 'collection.nml'), '<NML/>');
    }
    utimesSync(join(home, 'Documents', 'Native Instruments', 'Traktor 3.11.1', 'collection.nml'), new Date(), new Date(Date.now() - 86400_000));
    const libs = await findLibraries(home);
    expect(libs.map((l) => l.name)).toEqual(['Traktor Pro 4.1.0', 'Traktor Pro 3.11.1']);
    expect(await findLibraries(join(dir, 'nobody'))).toEqual([]);
  });
});
