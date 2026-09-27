import { describe, expect, it } from 'vitest';
import { buildIndex, resolveTrackFile } from '../pathmatch';

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
