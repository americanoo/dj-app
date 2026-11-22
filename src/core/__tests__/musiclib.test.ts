import { describe, expect, it } from 'vitest';
import { emptyLibrary, type Track } from '../model';
import { applyMove, folderMove, mergeScan, relinkMissing, type ScanEntry } from '../musiclib';

const entry = (path: string, patch: Partial<ScanEntry> = {}): ScanEntry => ({ path, size: 1000, mtimeMs: 1, fileId: 'fp:' + path, ...patch });
const track = (id: string, patch: Partial<Track>): Track => ({ id, title: id, artist: 'X', cues: [], source: 'traktor', ...patch });

describe('the library from music folders', () => {
  it('a new file becomes a track, named from its tags or else its file name', () => {
    const { library, added } = mergeScan(emptyLibrary(), [
      entry('/Music/House/DJ Alpha - Opening Theme.mp3', { bpm: 122, key: '8A', duration: 371.8 }),
      entry('/Music/Techno/track01.wav', { title: 'Warehouse', artist: 'Delta' }),
    ]);
    expect(added).toBe(2);
    const ts = Object.values(library.tracks);
    expect(ts[0]).toMatchObject({ title: 'Opening Theme', artist: 'DJ Alpha', bpm: 122, key: 'Am', duration: 371.8, source: 'folder' });
    expect(ts[1]).toMatchObject({ title: 'Warehouse', artist: 'Delta', path: '/Music/Techno/track01.wav' });
  });

  it("a file already in the library keeps what you and your DJ software set, and only fills what's missing", () => {
    const lib = { ...emptyLibrary(), tracks: { a: track('a', { path: '/Music/a.mp3', bpm: 124, cues: [{ id: 'c', kind: 'cue' as const, slot: 0, start: 1, name: '', color: '#fff' }] }) } };
    const { library, added, updated } = mergeScan(lib, [entry('/Music/a.mp3', { bpm: 62, key: 'Am', duration: 300 })]);
    expect(added).toBe(0);
    expect(updated).toBe(1);
    expect(library.tracks.a).toMatchObject({ bpm: 124, key: 'Am', duration: 300, fileId: 'fp:/Music/a.mp3' });
    expect(library.tracks.a.cues).toHaveLength(1);
  });

  it('matches paths with accents written either way (macOS decomposes them)', () => {
    const lib = { ...emptyLibrary(), tracks: { a: track('a', { path: '/Music/Café.mp3'.normalize('NFC') }) } };
    expect(mergeScan(lib, [entry('/Music/Café.mp3'.normalize('NFD'))]).added).toBe(0);
  });

  it('a file that moved is recognised by its fingerprint and takes its new place', () => {
    const lib = { ...emptyLibrary(), tracks: { a: track('a', { path: '/Volumes/OLD/a.mp3', fileId: 'same' }) } };
    const { library, moved, added } = mergeScan(lib, [entry('/Volumes/NEW/a.mp3', { fileId: 'same' })]);
    expect(moved).toBe(1);
    expect(added).toBe(0);
    expect(library.tracks.a.path).toBe('/Volumes/NEW/a.mp3');
  });
});

describe('finding missing files', () => {
  const entries = [
    entry('/Volumes/DJ DRIVE 2/Music/House/DJ Alpha - Opening Theme.mp3', { fileId: 'alpha' }),
    entry('/Volumes/DJ DRIVE 2/Music/Techno/Delta - Warehouse.wav'),
    entry('/Volumes/DJ DRIVE 2/Music/A/Intro.mp3'),
    entry('/Volumes/DJ DRIVE 2/Music/B/Intro.mp3'),
  ];

  it('by fingerprint (certain), then by name when only one missing track claims the file', () => {
    const missing = [
      track('a', { path: '/Volumes/DJ DRIVE/Music/House/renamed.mp3', fileId: 'alpha' }),
      track('w', { path: '/Volumes/DJ DRIVE/Music/Techno/Delta - Warehouse.wav' }),
      track('x', { path: '/Volumes/DJ DRIVE/Music/Gone - Forever.mp3' }),
    ];
    const { found, unresolved } = relinkMissing(missing, entries);
    expect(found.a).toBe('/Volumes/DJ DRIVE 2/Music/House/DJ Alpha - Opening Theme.mp3');
    expect(found.w).toBe('/Volumes/DJ DRIVE 2/Music/Techno/Delta - Warehouse.wav');
    expect(unresolved.map((t) => t.id)).toEqual(['x']);
  });

  it("two missing tracks wanting the same file get neither (that's for you to decide)", () => {
    const missing = [track('p', { path: '/Old/Intro.mp3' }), track('q', { path: '/Older/Intro.mp3' })];
    // Each is matched to one of the two Intro.mp3 files by its folders, or left: never both to one file.
    const { found } = relinkMissing(missing, entries.slice(0, 2).concat(entry('/X/Intro.mp3')));
    expect(Object.keys(found)).toHaveLength(0);
  });

  it('pointing at one file fixes its whole folder', () => {
    const move = folderMove('/Volumes/DJ DRIVE/Music/Techno/Delta - Warehouse.wav', '/Volumes/DJ DRIVE 2/Music/Techno/Delta - Warehouse.wav')!;
    expect(move).toEqual({ from: '/Volumes/DJ DRIVE', to: '/Volumes/DJ DRIVE 2' });
    expect(applyMove('/Volumes/DJ DRIVE/Music/House/a.mp3', move)).toBe('/Volumes/DJ DRIVE 2/Music/House/a.mp3');
    expect(applyMove('/Users/eric/Music/a.mp3', move)).toBeUndefined();
    // A different file name gives no folder rule.
    expect(folderMove('/a/b/one.mp3', '/c/d/two.mp3')).toBeUndefined();
  });
});
