import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportFor, importFile } from '../formats';
import { exportRekordbox, importRekordbox } from '../formats/rekordbox';
import { exportSeratoCrate, importSeratoCrate, seratoRelativePath } from '../formats/serato';
import { exportM3u, importCsv, importM3u, importPlainTracklist } from '../formats/text';
import { exportTraktor, importTraktor, locationToPath, pathToLocation } from '../formats/traktor';
import { emptyLibrary, type Track } from '../model';
import { mergeIntoLibrary } from '../merge';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
const opts = { playlistName: 'Test Set' };

describe('rekordbox XML', () => {
  const res = importRekordbox(fixture('rekordbox.xml'));
  const [alpha, beta] = res.tracks;

  it('reads track metadata and file locations', () => {
    expect(res.tracks).toHaveLength(2);
    expect(alpha).toMatchObject({
      title: 'Opening Theme',
      artist: 'DJ Alpha',
      bpm: 122,
      key: 'Am',
      duration: 372,
      label: 'Night Label',
      path: '/Users/dj/Music/DJ Alpha - Opening Theme.mp3',
      gridStart: 0.12,
    });
    expect(beta.artist).toBe('Beta & Gamma');
    expect(beta.path).toBe('C:/Music/Beta & Gamma - Peak Time.flac');
    expect(beta.key).toBe('Am'); // 8A normalised
  });

  it('finds the first downbeat when the grid starts mid-bar', () => {
    // Battito=3 at 0.5s, 126 BPM -> two beats later
    expect(beta.gridStart).toBeCloseTo(0.5 + 2 * (60 / 126), 3);
  });

  it('reads hot cues, memory cues and loops but skips fades', () => {
    expect(alpha.cues).toHaveLength(4);
    const loop = alpha.cues.find((c) => c.kind === 'loop')!;
    expect(loop).toMatchObject({ slot: 2, start: 300, end: 307.869, name: 'Outro loop', color: '#ff8c00' });
    const memory = alpha.cues.find((c) => c.slot === null)!;
    expect(memory.start).toBeCloseTo(31.593);
    expect(alpha.cues.find((c) => c.slot === 0)!.color).toBe('#28e214');
  });

  it('flattens nested playlist folders', () => {
    expect(res.playlists).toHaveLength(1);
    expect(res.playlists[0].name).toBe('Gigs / Friday');
    expect(res.playlists[0].trackIds).toEqual([beta.id, alpha.id]);
  });

  it('round-trips through export', () => {
    const file = exportRekordbox(res.tracks, [{ name: 'Round', trackIds: [alpha.id, beta.id] }], opts);
    const again = importRekordbox(file.data as string);
    expect(again.tracks.map((t) => t.path)).toEqual(res.tracks.map((t) => t.path));
    expect(again.tracks[0].cues.map(({ id: _id, ...c }) => c)).toEqual(alpha.cues.map(({ id: _id, ...c }) => c));
    expect(again.tracks[0].sourceIds?.rekordbox).toBe('101');
    expect(again.playlists[0].trackIds).toHaveLength(2);
    expect(file.data).toContain('Location="file://localhost/C:/Music/Beta%20%26%20Gamma%20-%20Peak%20Time.flac"');
  });
});

describe('Traktor NML', () => {
  const res = importTraktor(fixture('traktor.nml'));
  const [alpha, delta] = res.tracks;

  it('maps volumes to real paths', () => {
    expect(alpha.path).toBe('/Users/dj/Music/DJ Alpha - Opening Theme.mp3');
    expect(delta.path).toBe('/Volumes/USBSTICK/DJ/Techno/Delta - Warehouse.wav');
    expect(locationToPath('C:', '/:Music/:', 'a.mp3')).toBe('C:/Music/a.mp3');
    expect(pathToLocation('C:/Music/a.mp3', 'x')).toEqual({ volume: 'C:', dir: '/:Music/:', file: 'a.mp3' });
    expect(pathToLocation('/Users/dj/a.mp3', 'Macintosh HD')).toEqual({
      volume: 'Macintosh HD',
      dir: '/:Users/:dj/:',
      file: 'a.mp3',
    });
  });

  it('reads keys, grid and cues (ms -> s)', () => {
    expect(alpha.key).toBe('Am');
    expect(delta.key).toBe('F');
    expect(alpha.gridStart).toBeCloseTo(0.12);
    expect(alpha.cues).toHaveLength(3);
    expect(alpha.cues.find((c) => c.kind === 'loop')).toMatchObject({ slot: 2, start: 300, name: '' });
    expect(alpha.cues.find((c) => c.kind === 'loop')!.end).toBeCloseTo(307.869);
  });

  it('resolves playlist primary keys', () => {
    expect(res.playlists[0]).toMatchObject({ name: 'Saturday', trackIds: [delta.id, alpha.id] });
  });

  it('round-trips through export', () => {
    const file = exportTraktor(res.tracks, [{ name: 'Round', trackIds: [delta.id, alpha.id] }], opts);
    const again = importTraktor(file.data as string);
    expect(again.tracks.map((t) => t.path)).toEqual(res.tracks.map((t) => t.path));
    expect(again.tracks[0].cues.map((c) => [c.kind, c.slot, c.start])).toEqual(alpha.cues.map((c) => [c.kind, c.slot, c.start]));
    expect(again.tracks[0].gridStart).toBeCloseTo(0.12);
    expect(again.playlists[0].trackIds).toHaveLength(2);
  });
});

describe('cross-software conversion', () => {
  it('rekordbox cues survive a trip through Traktor and back', () => {
    const rb = importRekordbox(fixture('rekordbox.xml'));
    const nml = exportTraktor(rb.tracks, [{ name: 'x', trackIds: rb.tracks.map((t) => t.id) }], opts);
    const tk = importTraktor(nml.data as string);
    const xml = exportRekordbox(tk.tracks, [{ name: 'x', trackIds: tk.tracks.map((t) => t.id) }], opts);
    const back = importRekordbox(xml.data as string);
    const summary = (t: Track) =>
      t.cues.map((c) => `${c.kind}:${c.slot}:${c.start.toFixed(3)}:${c.end?.toFixed(3) ?? ''}:${c.name}`).sort();
    expect(summary(back.tracks[0])).toEqual(summary(rb.tracks[0]));
    expect(back.tracks[1].path).toBe('C:/Music/Beta & Gamma - Peak Time.flac');
  });

  it('applies a global cue offset and path rewrite on export', () => {
    const rb = importRekordbox(fixture('rekordbox.xml'));
    const { file } = exportFor('rekordbox', rb.tracks, [rb.tracks[0].id], {
      ...opts,
      offsetMs: 26,
      pathFrom: '/Users/dj/Music',
      pathTo: '/Volumes/GIG/Music',
    });
    const back = importRekordbox(file.data as string);
    expect(back.tracks[0].cues.find((c) => c.slot === 1)!.start).toBeCloseTo(63.092);
    expect(back.tracks[0].path).toBe('/Volumes/GIG/Music/DJ Alpha - Opening Theme.mp3');
  });

  it('detects file formats from content', () => {
    expect(importFile('lib.xml', new TextEncoder().encode(fixture('rekordbox.xml'))).format).toBe('rekordbox');
    expect(importFile('collection.nml', new TextEncoder().encode(fixture('traktor.nml'))).format).toBe('traktor');
  });

  it('merges the same file imported from two programs', () => {
    const rb = importRekordbox(fixture('rekordbox.xml'));
    const tk = importTraktor(fixture('traktor.nml'));
    const a = mergeIntoLibrary(emptyLibrary(), rb);
    const b = mergeIntoLibrary(a.library, tk);
    expect(b.added).toBe(1); // Delta - Warehouse
    expect(b.updated).toBe(1); // Opening Theme, same path
    expect(Object.keys(b.library.tracks)).toHaveLength(3);
  });
});

describe('Serato crates', () => {
  it('writes and reads crate files', () => {
    const tracks: Track[] = [
      { id: 'a', title: 'A', artist: 'X', path: '/Users/dj/Music/X - A.mp3', cues: [], source: 'manual' },
      { id: 'b', title: 'B', artist: 'Y', path: '/Volumes/USB/Music/Y - B.mp3', cues: [], source: 'manual' },
    ];
    const file = exportSeratoCrate(tracks, opts);
    const bytes = file.data as Uint8Array;
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('vrsn');
    expect(file.drives).toEqual(['system drive', 'USB']);
    const back = importSeratoCrate(bytes, 'Parent%%Child');
    expect(back.playlists[0].name).toBe('Parent / Child');
    expect(back.tracks.map((t) => t.path)).toEqual(['/Users/dj/Music/X - A.mp3', '/Music/Y - B.mp3']);
    expect(back.tracks[0]).toMatchObject({ artist: 'X', title: 'A' });
  });

  it('computes drive-relative paths', () => {
    expect(seratoRelativePath('C:\\Music\\a.mp3')).toEqual({ drive: 'C:', rel: 'Music/a.mp3' });
  });
});

describe('text formats', () => {
  it('reads and writes M3U8', () => {
    const m3u = '#EXTM3U\n#EXTINF:300,Artist One - Song One\n/music/a.mp3\n/music/Two - Song Two.mp3\n';
    const res = importM3u(m3u, 'pl');
    expect(res.tracks[0]).toMatchObject({ artist: 'Artist One', title: 'Song One', duration: 300, path: '/music/a.mp3' });
    expect(res.tracks[1]).toMatchObject({ artist: 'Two', title: 'Song Two' });
    const out = exportM3u(res.tracks, opts).data as string;
    expect(out).toContain('#EXTINF:300,Artist One - Song One\n/music/a.mp3');
  });

  it('finds the header row in Serato history CSVs', () => {
    const csv = [
      'Session,Friday Night',
      '',
      'name,artist,bpm,key,start time',
      '"Song, With Comma",Artist A,124,Fm,21:00:01',
      'Other,Artist B,,8A,21:05:00',
    ].join('\n');
    const res = importCsv(csv, 'history');
    expect(res.tracks).toHaveLength(2);
    expect(res.tracks[0]).toMatchObject({ title: 'Song, With Comma', artist: 'Artist A', bpm: 124, key: 'Fm' });
    expect(res.tracks[1].key).toBe('Am');
  });

  it('reads plain tracklists', () => {
    const res = importPlainTracklist('01. Artist - Title [Label]\n[12:30] Other Artist – Other Title\n', 'tl');
    expect(res.tracks[0]).toMatchObject({ artist: 'Artist', title: 'Title', label: 'Label' });
    expect(res.tracks[1]).toMatchObject({ artist: 'Other Artist', title: 'Other Title' });
  });
});
