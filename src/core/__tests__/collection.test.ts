import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportCollection, importFile } from '../formats';
import { isChangedInSetcraft, type Track } from '../model';
import { reducer } from '../../ui/store';
import { emptyProject } from '../model';

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)));
const tracks = (): Track[] => importFile('rekordbox.xml', fixture('rekordbox.xml')).tracks;

describe('collection export', () => {
  it('writes every track with its cues, with no playlist unless asked', () => {
    const t = tracks();
    const xml = exportCollection('rekordbox', t, [], { playlistName: 'Setcraft collection' }).file.data as string;
    expect((xml.match(/<TRACK TrackID=/g) ?? []).length).toBe(t.length);
    expect((xml.match(/<POSITION_MARK/g) ?? []).length).toBe(t.reduce((n, x) => n + x.cues.length, 0));
    expect(xml).toContain('<NODE Type="0" Name="ROOT" Count="0">');
  });

  it('adds the requested playlists, and leaves out tracks without a file', () => {
    const t = tracks();
    const noFile = { ...t[0], id: 'nofile', path: undefined };
    const { file, notes } = exportCollection(
      'traktor',
      [...t, noFile],
      [
        { name: 'Setcraft updates', trackIds: [t[0].id, 'nofile'] },
        { name: 'Friday set', trackIds: [t[1].id, t[0].id] },
      ],
      { playlistName: 'Setcraft collection' },
    );
    const nml = file.data as string;
    expect(nml).toContain(`<COLLECTION ENTRIES="${t.length}">`);
    expect(nml).toContain('NAME="Setcraft updates"');
    expect(nml).toContain('NAME="Friday set"');
    expect(notes[0]).toMatch(/1 track\(s\) have no file location/);
  });
});

describe('changed in Setcraft', () => {
  const load = () => {
    const result = importFile('rekordbox.xml', fixture('rekordbox.xml'));
    return reducer(emptyProject(), { type: 'import', result });
  };

  it('imported tracks start unchanged', () => {
    expect(Object.values(load().library.tracks).some(isChangedInSetcraft)).toBe(false);
  });

  it('cue, BPM and key edits mark a track changed; bookkeeping does not', () => {
    let p = load();
    const [a, b, c] = Object.keys(p.library.tracks);
    p = reducer(p, { type: 'setCues', trackId: a, cues: [] }); // deleting every cue is a change too
    p = reducer(p, { type: 'updateTrack', id: b, patch: { key: 'Fm' } });
    p = reducer(p, { type: 'updateTrack', id: c ?? b, patch: { duration: 300 } });
    expect(isChangedInSetcraft(p.library.tracks[a])).toBe(true);
    expect(isChangedInSetcraft(p.library.tracks[b])).toBe(true);
    if (c) expect(isChangedInSetcraft(p.library.tracks[c])).toBe(false);
  });

  it('survives re-importing the same collection', () => {
    let p = load();
    const [a] = Object.keys(p.library.tracks);
    p = reducer(p, { type: 'updateTrack', id: a, patch: { bpm: 123 } });
    p = reducer(p, { type: 'import', result: importFile('rekordbox.xml', fixture('rekordbox.xml')) });
    expect(isChangedInSetcraft(p.library.tracks[a])).toBe(true);
  });
});
