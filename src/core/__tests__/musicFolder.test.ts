import { describe, expect, it } from 'vitest';
import { walk, type DirHandle, type FileHandle } from '../../ui/musicFolder';
import { buildIndex, resolveTrackFile } from '../pathmatch';

const file = (name: string): FileHandle => ({ kind: 'file', name, getFile: async () => new File([], name) });
const dir = (name: string, entries: (DirHandle | FileHandle)[]): DirHandle => ({
  kind: 'directory',
  name,
  async *values() {
    yield* entries;
  },
});

describe('scanning a linked folder (File System Access API)', () => {
  it('indexes audio files recursively and skips hidden folders and DJ databases', async () => {
    const root = dir('Music', [
      dir('House', [file('A - One.mp3'), file('cover.jpg'), dir('Deep', [file('B - Two.flac')])]),
      dir('.Trash', [file('Deleted.mp3')]),
      dir('_Serato_', [file('database V2')]),
      dir('PIONEER', [file('export.pdb'), file('preview.mp3')]),
      file('.DS_Store'),
      file('C - Three.AIFF'),
    ]);
    const found = new Map<string, FileHandle>();
    await walk(root, '', found, () => undefined);
    expect([...found.keys()].sort()).toEqual(['C - Three.AIFF', 'House/A - One.mp3', 'House/Deep/B - Two.flac']);

    const index = buildIndex(found.keys());
    const rel = resolveTrackFile('/Users/eric/Music/House/Deep/B - Two.flac', index)!;
    expect((await found.get(rel)!.getFile()).name).toBe('B - Two.flac');
  });

  it('finds music at any depth, including in folders named after DJ programs', async () => {
    const root = dir('Music', [
      dir('Genres', [dir('Techno', [dir('2024', [dir('Label Promos', [file('Deep - Down.wav')])])])]),
      dir('Traktor', [dir('Recordings', [file('Live set.wav')])]),
      dir('rekordbox', [file('Edit.mp3')]),
      dir('Music', [dir('Media.localized', [dir('Music', [dir('Artist', [dir('Album', [file('01 Song.m4a')])])])])]),
    ]);
    const found = new Map<string, FileHandle>();
    await walk(root, '', found, () => undefined);
    expect([...found.keys()].sort()).toEqual([
      'Genres/Techno/2024/Label Promos/Deep - Down.wav',
      'Music/Media.localized/Music/Artist/Album/01 Song.m4a',
      'Traktor/Recordings/Live set.wav',
      'rekordbox/Edit.mp3',
    ]);
    const index = buildIndex(found.keys());
    expect(resolveTrackFile('/Users/eric/Music/Genres/Techno/2024/Label Promos/Deep - Down.wav', index)).toBe(
      'Genres/Techno/2024/Label Promos/Deep - Down.wav',
    );
  });
});
