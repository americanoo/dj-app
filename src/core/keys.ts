/**
 * Musical key helpers. Internally a key is a pitch class (0 = C) plus a
 * major/minor flag; every notation the DJ programs use is parsed into that.
 */

export interface MusicalKey {
  pitch: number;
  minor: boolean;
}

const MAJOR_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_NAMES = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];

const LETTER_PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function parseKey(raw: string | undefined | null): MusicalKey | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  // Camelot: 1A-12A (minor), 1B-12B (major)
  let m = /^(1[0-2]|[1-9])\s*([AB])$/i.exec(s);
  if (m) {
    const n = Number(m[1]);
    const minor = m[2].toUpperCase() === 'A';
    const majorPitch = (((n - 8) * 7) % 12 + 12) % 12;
    return { pitch: minor ? (majorPitch + 9) % 12 : majorPitch, minor };
  }

  // Open Key: 1d-12d (major), 1m-12m (minor)
  m = /^(1[0-2]|[1-9])\s*([dm])$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    const minor = m[2] === 'm';
    const majorPitch = (((n - 1) * 7) % 12 + 12) % 12;
    return { pitch: minor ? (majorPitch + 9) % 12 : majorPitch, minor };
  }

  // Standard: C, C#, Db, Am, A minor, F# maj, Ebmin, B♭m …
  m = /^([A-G])\s*([#♯b♭]?)\s*(m|min|minor|maj|major)?$/i.exec(s);
  if (m) {
    const letter = m[1].toUpperCase();
    let pitch = LETTER_PITCH[letter];
    if (m[2] === '#' || m[2] === '♯') pitch += 1;
    if (m[2] === 'b' || m[2] === '♭') pitch -= 1;
    const q = (m[3] ?? '').toLowerCase();
    const minor = q === 'm' || q === 'min' || q === 'minor';
    return { pitch: (pitch + 12) % 12, minor };
  }
  return null;
}

export function keyName(k: MusicalKey): string {
  return k.minor ? MINOR_NAMES[k.pitch] : MAJOR_NAMES[k.pitch];
}

/** Normalise any key notation to standard names ("Am", "F#"). Unknown input is returned as-is. */
export function normaliseKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const k = parseKey(raw);
  return k ? keyName(k) : raw;
}

function camelotNumber(k: MusicalKey): number {
  const majorPitch = k.minor ? (k.pitch + 3) % 12 : k.pitch;
  return ((majorPitch * 7) % 12 + 7) % 12 + 1;
}

export function toCamelot(raw: string | undefined): string | undefined {
  const k = parseKey(raw);
  if (!k) return undefined;
  return `${camelotNumber(k)}${k.minor ? 'A' : 'B'}`;
}

export function toOpenKey(raw: string | undefined): string | undefined {
  const k = parseKey(raw);
  if (!k) return undefined;
  const n = ((camelotNumber(k) - 8 + 12) % 12) + 1;
  return `${n}${k.minor ? 'm' : 'd'}`;
}

/** Traktor's MUSICAL_KEY VALUE: 0-11 major from C, 12-23 minor from Cm. */
export function fromTraktorKeyValue(v: number): string | undefined {
  if (!Number.isInteger(v) || v < 0 || v > 23) return undefined;
  return keyName({ pitch: v % 12, minor: v >= 12 });
}

export function toTraktorKeyValue(raw: string | undefined): number | undefined {
  const k = parseKey(raw);
  if (!k) return undefined;
  return k.pitch + (k.minor ? 12 : 0);
}

export type KeyRelation = 'same' | 'adjacent' | 'relative' | 'diagonal' | 'boost' | 'clash' | 'unknown';

/** Harmonic-mixing relation between two keys on the Camelot wheel. */
export function keyRelation(a: string | undefined, b: string | undefined): KeyRelation {
  const ka = parseKey(a);
  const kb = parseKey(b);
  if (!ka || !kb) return 'unknown';
  const na = camelotNumber(ka);
  const nb = camelotNumber(kb);
  const diff = (nb - na + 12) % 12;
  if (ka.minor === kb.minor) {
    if (diff === 0) return 'same';
    if (diff === 1 || diff === 11) return 'adjacent';
    if (diff === 2 || diff === 7) return 'boost';
    return 'clash';
  }
  if (diff === 0) return 'relative';
  // 8A -> 7B / 9B: the keys share six of seven notes.
  return diff === 1 || diff === 11 ? 'diagonal' : 'clash';
}
