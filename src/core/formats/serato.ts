/**
 * Serato DJ crates (`_Serato_/Subcrates/<name>.crate`).
 *
 * A crate is a flat sequence of tagged fields: 4-byte ASCII tag, big-endian
 * u32 length, payload. Strings are UTF-16BE. Container tags (`o…`) hold
 * nested fields.
 *
 *   vrsn  "1.0/Serato ScratchLive Crate"
 *   osrt  { tvcn "song", brev 0x00 }           sort column
 *   ovct  { tvcn "song", tvcw "0" }            visible columns (repeated)
 *   otrk  { ptrk "Users/me/Music/a.mp3" }      one per track, path relative to the volume root
 *
 * Serato stores cue points inside the audio files' tags rather than in the
 * crate, so crate import brings track order only.
 */
import { uid, type Playlist, type Track } from '../model';
import { guessFromFileName } from '../xml';
import { applyPathRewrite, type ExportFile, type ExportOptions, type ImportResult } from './types';
import { safeName } from './rekordbox';

const VERSION = '1.0/Serato ScratchLive Crate';
const COLUMNS = ['song', 'artist', 'bpm', 'key', 'album', 'length', 'comment'];

export function isSeratoCrate(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && String.fromCharCode(...bytes.slice(0, 4)) === 'vrsn';
}

interface Field {
  tag: string;
  data: Uint8Array;
}

function readFields(bytes: Uint8Array): Field[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fields: Field[] = [];
  let i = 0;
  while (i + 8 <= bytes.length) {
    const tag = String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]);
    const len = view.getUint32(i + 4);
    const start = i + 8;
    const end = Math.min(start + len, bytes.length);
    fields.push({ tag, data: bytes.subarray(start, end) });
    i = end;
  }
  return fields;
}

function decodeUtf16be(data: Uint8Array): string {
  let s = '';
  for (let i = 0; i + 1 < data.length; i += 2) s += String.fromCharCode((data[i] << 8) | data[i + 1]);
  return s;
}

function encodeUtf16be(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i * 2] = c >> 8;
    out[i * 2 + 1] = c & 0xff;
  }
  return out;
}

function field(tag: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  for (let i = 0; i < 4; i++) out[i] = tag.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, payload.length);
  out.set(payload, 8);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Import a crate. `name` is usually the file name without `.crate`. */
export function importSeratoCrate(bytes: Uint8Array, name: string): ImportResult {
  if (!isSeratoCrate(bytes)) throw new Error('Not a Serato crate file');
  const tracks: Track[] = [];
  for (const f of readFields(bytes)) {
    if (f.tag !== 'otrk') continue;
    const ptrk = readFields(f.data).find((x) => x.tag === 'ptrk');
    if (!ptrk) continue;
    const rel = decodeUtf16be(ptrk.data);
    const path = /^[A-Za-z]:/.test(rel) || rel.startsWith('/') ? rel : '/' + rel;
    const guess = guessFromFileName(path);
    tracks.push({ id: uid('trk'), title: guess.title, artist: guess.artist, path, cues: [], source: 'serato' });
  }
  // Crates named "Parent%%Child" are sub-crates.
  const display = name.replace(/%%/g, ' / ');
  const playlist: Playlist = { id: uid('pl'), name: display, trackIds: tracks.map((t) => t.id), source: 'serato' };
  return {
    format: 'serato',
    tracks,
    playlists: [playlist],
    warnings: [
      'Serato crates only contain file paths. Import your rekordbox/Traktor collection or a Serato history CSV too for titles, BPM and keys.',
    ],
  };
}

/** Path as Serato stores it: relative to the root of the drive the file lives on. */
export function seratoRelativePath(path: string): { drive: string; rel: string } {
  const p = path.replace(/\\/g, '/');
  const win = /^([A-Za-z]:)\/(.*)$/.exec(p);
  if (win) return { drive: win[1].toUpperCase(), rel: win[2] };
  const vol = /^\/Volumes\/([^/]+)\/(.*)$/.exec(p);
  if (vol) return { drive: vol[1], rel: vol[2] };
  return { drive: '', rel: p.replace(/^\/+/, '') };
}

export function exportSeratoCrate(tracks: Track[], opts: ExportOptions): ExportFile & { drives: string[] } {
  const parts: Uint8Array[] = [field('vrsn', encodeUtf16be(VERSION))];
  parts.push(field('osrt', concat([field('tvcn', encodeUtf16be('song')), field('brev', new Uint8Array([0]))])));
  for (const col of COLUMNS) {
    parts.push(field('ovct', concat([field('tvcn', encodeUtf16be(col)), field('tvcw', encodeUtf16be('0'))])));
  }
  const drives = new Set<string>();
  for (const t of tracks) {
    const path = applyPathRewrite(t.path, opts);
    if (!path) continue;
    const { drive, rel } = seratoRelativePath(path);
    drives.add(drive || 'system drive');
    parts.push(field('otrk', field('ptrk', encodeUtf16be(rel))));
  }
  return {
    fileName: `${safeName(opts.playlistName)}.crate`,
    mime: 'application/octet-stream',
    data: concat(parts),
    drives: [...drives],
  };
}
