import { describe, expect, it } from 'vitest';
import { buildIndex, findTrackFile, looseKey, resolveTrackFile } from '../pathmatch';

describe('finding tracks in a linked folder', () => {
  const index = buildIndex([
    'House/DJ Alpha - Opening Theme.mp3',
    'Techno/Delta - Warehouse.wav',
    'Techno/Edits/Intro.mp3',
    'House/Old/Intro.mp3',
    'Café del Mar.mp3'.normalize('NFD'), // how macOS may hand us accented names
    'cover.jpg',
  ]);

  it('matches by file name wherever the folder was linked from', () => {
    expect(resolveTrackFile('/Users/eric/Music/House/DJ Alpha - Opening Theme.mp3', index)).toBe(
      'House/DJ Alpha - Opening Theme.mp3',
    );
    // Library says USB drive, folder linked is the laptop copy: name still matches.
    expect(resolveTrackFile('/Volumes/USB/DJ/Techno/Delta - Warehouse.wav', index)).toBe('Techno/Delta - Warehouse.wav');
    expect(resolveTrackFile('C:\\Music\\Techno\\delta - warehouse.WAV', index)).toBe('Techno/Delta - Warehouse.wav');
  });

  it('picks the right file when names repeat, by parent folders', () => {
    expect(resolveTrackFile('/Users/eric/Music/Techno/Edits/Intro.mp3', index)).toBe('Techno/Edits/Intro.mp3');
    expect(resolveTrackFile('/Users/eric/Music/House/Old/Intro.mp3', index)).toBe('House/Old/Intro.mp3');
  });

  it('treats composed and decomposed accents as the same name', () => {
    expect(resolveTrackFile('/Music/Café del Mar.mp3'.normalize('NFC'), index)).toBe('Café del Mar.mp3'.normalize('NFD'));
  });

  it('returns nothing when the file is not there', () => {
    expect(resolveTrackFile('/Music/Missing.mp3', index)).toBeUndefined();
    expect(resolveTrackFile(undefined, index)).toBeUndefined();
    expect(index.count).toBe(6);
  });
});

describe('finding a track when its copy is named differently', () => {
  const index = buildIndex([
    'Phone Music/01 - DJ Alpha - Opening Theme.m4a',
    'Phone Music/delta_-_warehouse.mp3',
    'Phone Music/Sunrise (Original Mix) - Gamma.mp3',
    'Phone Music/Kappa/Night Album/03 Lights.mp3',
    'Phone Music/Other/Night Album/03 Lights.mp3',
    'Phone Music/2 Hearts.mp3',
  ]);

  it('takes extension, numbering, case and punctuation out of names', () => {
    expect(looseKey('01_DJ_Alpha-Opening_Theme.m4a')).toBe('dj alpha opening theme');
    expect(looseKey('DJ Alpha - Opening Theme.mp3')).toBe('dj alpha opening theme');
    expect(looseKey('2 Hearts.mp3')).toBe('2 hearts');
  });

  it('finds a converted, renumbered copy wherever the library says the original was', () => {
    const track = { path: '/Volumes/DJ Drive/House/DJ Alpha - Opening Theme.aiff', artist: 'DJ Alpha', title: 'Opening Theme' };
    expect(findTrackFile(track, index)).toBe('Phone Music/01 - DJ Alpha - Opening Theme.m4a');
    expect(findTrackFile({ path: 'D:\\Techno\\Delta - Warehouse.wav' }, index)).toBe('Phone Music/delta_-_warehouse.mp3');
  });

  it('falls back to Artist - Title, either way round, when the file name tells nothing', () => {
    expect(findTrackFile({ path: '/Volumes/USB/Contents/a8f3e1.mp3', artist: 'Gamma', title: 'Sunrise (Original Mix)' }, index)).toBe(
      'Phone Music/Sunrise (Original Mix) - Gamma.mp3',
    );
  });

  it('finds Artist/Album/01 Title.mp3 by the artist folder', () => {
    expect(findTrackFile({ path: '/x/y.mp3', artist: 'Kappa', title: 'Lights' }, index)).toBe('Phone Music/Kappa/Night Album/03 Lights.mp3');
    expect(findTrackFile({ path: '/x/y.mp3', artist: 'Nobody', title: 'Lights' }, index)).toBeUndefined();
  });

  it('still prefers the exact name, and finds nothing for a different song', () => {
    expect(findTrackFile({ path: '/Music/2 Hearts.mp3', title: 'Hearts' }, index)).toBe('Phone Music/2 Hearts.mp3');
    expect(findTrackFile({ path: '/Music/Missing.mp3', artist: 'DJ Alpha', title: 'Closing Theme' }, index)).toBeUndefined();
    expect(findTrackFile({}, index)).toBeUndefined();
  });
});
