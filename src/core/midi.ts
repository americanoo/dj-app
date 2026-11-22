/**
 * DJ controller support over Web MIDI.
 *
 * Every controller sends different messages, so controls are mapped by
 * "learn": pick an action, press or turn the control, done. This module is
 * the pure part: reading MIDI bytes, matching them to mapped actions, and
 * decoding jog wheels (which send relative movement in one of two encodings).
 */

export type MidiControlKind = 'button' | 'knob' | 'jog';

export interface MidiActionInfo {
  id: string;
  label: string;
  kind: MidiControlKind;
}

export const MIDI_ACTIONS: MidiActionInfo[] = [
  { id: 'play', label: 'Play / pause', kind: 'button' },
  ...Array.from({ length: 8 }, (_, i) => ({ id: `pad${i + 1}`, label: `Hot cue ${'ABCDEFGH'[i]}`, kind: 'button' as const })),
  { id: 'jog', label: 'Jog wheel (scrub)', kind: 'jog' },
  { id: 'volume', label: 'Volume', kind: 'knob' },
  { id: 'barBack', label: 'Back one bar', kind: 'button' },
  { id: 'barFwd', label: 'Forward one bar', kind: 'button' },
  { id: 'loop', label: 'Loop 4 beats at playhead', kind: 'button' },
  { id: 'loopExit', label: 'Exit loop', kind: 'button' },
  { id: 'memory', label: 'Memory cue at playhead', kind: 'button' },
  { id: 'fxEcho', label: 'Echo out', kind: 'button' },
  { id: 'fxReverb', label: 'Reverb out', kind: 'button' },
  { id: 'fxLoop', label: 'Loop out', kind: 'button' },
  { id: 'fxSpin', label: 'Backspin', kind: 'button' },
  { id: 'fxMix', label: 'FX dry/wet', kind: 'knob' },
  { id: 'prevTrack', label: 'Previous track in the night', kind: 'button' },
  { id: 'nextTrack', label: 'Next track in the night', kind: 'button' },
  { id: 'snap', label: 'Snap: Free / Beat / Bar', kind: 'button' },
];

export interface MidiMessage {
  type: 'note' | 'cc';
  /** 1–16, as controllers' manuals number them. */
  channel: number;
  number: number;
  /** Velocity or controller value, 0–127 (note off = 0). */
  value: number;
}

/** Relative encodings used by jog wheels and endless encoders. */
export type JogEncoding = 'twos' | 'offset';

export interface MidiBinding {
  type: 'note' | 'cc';
  channel: number;
  number: number;
  encoding?: JogEncoding;
}

export type MidiMap = Record<string, MidiBinding>;

/** Note on / note off / control change; anything else (clock, sysex…) is ignored. */
export function parseMidi(data: ArrayLike<number>): MidiMessage | null {
  if (data.length < 3) return null;
  const type = data[0] & 0xf0;
  const channel = (data[0] & 0x0f) + 1;
  if (type === 0x90) return { type: 'note', channel, number: data[1], value: data[2] };
  if (type === 0x80) return { type: 'note', channel, number: data[1], value: 0 };
  if (type === 0xb0) return { type: 'cc', channel, number: data[1], value: data[2] };
  return null;
}

export function describeBinding(b: MidiBinding): string {
  return `${b.type === 'note' ? 'Note' : 'CC'} ${b.number} · ch ${b.channel}`;
}

const same = (b: MidiBinding, m: MidiMessage) => b.type === m.type && b.channel === m.channel && b.number === m.number;

/** Which action a message is for, if any. */
export function actionFor(map: MidiMap, m: MidiMessage): string | undefined {
  return Object.keys(map).find((id) => same(map[id], m));
}

/** Buttons fire on press: a note with velocity, or a CC going above the middle (many controllers send 127 / 0). */
export function isPress(m: MidiMessage): boolean {
  return m.value > (m.type === 'cc' ? 63 : 0);
}

/**
 * Jog movement in ticks (+ forwards). Two's complement sends 1, 2, 3… forwards
 * and 127, 126… backwards; offset encoding centres on 64 (65 = +1, 63 = -1).
 */
export function jogDelta(value: number, encoding: JogEncoding): number {
  if (encoding === 'offset') return value - 64;
  return value < 64 ? value : value - 128;
}

/** A jog turned during learn: values clustered around 64 mean offset encoding. */
export function guessEncoding(values: number[]): JogEncoding {
  if (!values.length) return 'twos';
  const nearMiddle = values.filter((v) => v >= 48 && v <= 80).length;
  return nearMiddle * 2 >= values.length ? 'offset' : 'twos';
}

/**
 * Bind a control to an action. The same control can't drive two actions, so
 * it's released from any other action first.
 */
export function learn(map: MidiMap, actionId: string, messages: MidiMessage[]): MidiMap {
  const info = MIDI_ACTIONS.find((a) => a.id === actionId);
  const first = messages[0];
  if (!info || !first) return map;
  if (info.kind !== 'button' && first.type !== 'cc') return map; // knobs and jogs send CC
  const binding: MidiBinding = { type: first.type, channel: first.channel, number: first.number };
  if (info.kind === 'jog') binding.encoding = guessEncoding(messages.filter((m) => same(binding, m)).map((m) => m.value));
  const next: MidiMap = {};
  for (const [id, b] of Object.entries(map)) if (!(b.type === binding.type && b.channel === binding.channel && b.number === binding.number)) next[id] = b;
  next[actionId] = binding;
  return next;
}
