import { describe, expect, it } from 'vitest';
import { actionFor, guessEncoding, isPress, jogDelta, learn, parseMidi, type MidiMessage } from '../midi';

const note = (n: number, v = 127, ch = 1): MidiMessage => ({ type: 'note', channel: ch, number: n, value: v });
const cc = (n: number, v: number, ch = 1): MidiMessage => ({ type: 'cc', channel: ch, number: n, value: v });

describe('MIDI messages', () => {
  it('reads note on / off and control changes with 1-based channels', () => {
    expect(parseMidi([0x90, 36, 100])).toEqual(note(36, 100));
    expect(parseMidi([0x97, 36, 0])).toEqual(note(36, 0, 8)); // note on with velocity 0 = off
    expect(parseMidi([0x80, 36, 64])).toEqual(note(36, 0));
    expect(parseMidi([0xb1, 33, 65])).toEqual(cc(33, 65, 2));
    expect(parseMidi([0xf8])).toBeNull(); // clock
    expect(parseMidi([0xe0, 0, 64])).toBeNull(); // pitch bend isn't used
  });

  it('treats notes with velocity and CCs above the middle as presses', () => {
    expect(isPress(note(1, 1))).toBe(true);
    expect(isPress(note(1, 0))).toBe(false);
    expect(isPress(cc(1, 127))).toBe(true);
    expect(isPress(cc(1, 0))).toBe(false);
  });
});

describe('jog wheels', () => {
  it('decodes both relative encodings', () => {
    expect([1, 3, 127, 125].map((v) => jogDelta(v, 'twos'))).toEqual([1, 3, -1, -3]);
    expect([65, 67, 63, 61].map((v) => jogDelta(v, 'offset'))).toEqual([1, 3, -1, -3]);
  });

  it('works out the encoding from a turn during learn', () => {
    expect(guessEncoding([1, 2, 1, 3, 127, 126])).toBe('twos');
    expect(guessEncoding([65, 66, 65, 63, 62])).toBe('offset');
  });
});

describe('MIDI learn', () => {
  it('binds a control, and a control can only drive one action', () => {
    let map = learn({}, 'play', [note(11)]);
    map = learn(map, 'pad1', [note(0, 127, 8)]);
    expect(actionFor(map, note(11))).toBe('play');
    expect(actionFor(map, note(0, 90, 8))).toBe('pad1');
    expect(actionFor(map, note(0, 90, 1))).toBeUndefined(); // other channel
    // re-learning the play button as cue A moves it
    map = learn(map, 'pad1', [note(11)]);
    expect(actionFor(map, note(11))).toBe('pad1');
    expect(map.play).toBeUndefined();
  });

  it('only binds knobs and jogs to controls that send CC, and remembers the jog encoding', () => {
    expect(learn({}, 'volume', [note(3)])).toEqual({});
    const map = learn({}, 'jog', [cc(34, 65), cc(34, 66), cc(34, 63)]);
    expect(map.jog).toEqual({ type: 'cc', channel: 1, number: 34, encoding: 'offset' });
  });
});
