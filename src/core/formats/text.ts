/**
 * Plain-text tracklist formats that every DJ program can read or write:
 *   - M3U / M3U8 playlists (rekordbox, Traktor, Serato, djay Pro, VirtualDJ)
 *   - CSV / TSV exports (Serato & djay history, spreadsheets)
 *   - Plain "Artist - Title" tracklists (one per line, numbering optional)
 */
import { uid, type SourceFormat, type Track } from '../model';
import { normaliseKey } from '../keys';
import { parseTime } from '../time';
import { guessFromFileName } from '../xml';
import { applyPathRewrite, type ExportFile, type ExportOptions, type ImportResult } from './types';
import { safeName } from './rekordbox';

export function importM3u(text: string, name: string): ImportResult {
  const tracks: Track[] = [];
  let pending: { duration?: number; artist?: string; title?: string } = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line === '#EXTM3U') continue;
    if (line.startsWith('#EXTINF:')) {
      const m = /^#EXTINF:(-?[\d.]+)[^,]*,(.*)$/.exec(line);
      if (m) {
        const dur = Number(m[1]);
        const at = /^(.+?)\s+-\s+(.+)$/.exec(m[2].trim());
        pending = {
          duration: dur > 0 ? dur : undefined,
          artist: at ? at[1] : undefined,
          title: at ? at[2] : m[2].trim() || undefined,
        };
      }
      continue;
    }
    if (line.startsWith('#')) continue;
    const path = line.replace(/^file:\/\/(localhost)?/i, '');
    const guess = guessFromFileName(path);
    tracks.push({
      id: uid('trk'),
      title: pending.title ?? guess.title,
      artist: pending.artist ?? guess.artist,
      duration: pending.duration,
      path: safeDecode(path),
      cues: [],
      source: 'm3u',
    });
    pending = {};
  }
  return {
    format: 'm3u',
    tracks,
    playlists: [{ id: uid('pl'), name, trackIds: tracks.map((t) => t.id), source: 'm3u' }],
    warnings: [],
  };
}

function safeDecode(s: string): string {
  if (!/%[0-9a-f]{2}/i.test(s)) return s;
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function exportM3u(tracks: Track[], opts: ExportOptions): ExportFile {
  const lines = ['#EXTM3U', `#PLAYLIST:${opts.playlistName}`];
  for (const t of tracks) {
    const path = applyPathRewrite(t.path, opts);
    if (!path) continue;
    lines.push(`#EXTINF:${Math.round(t.duration ?? -1)},${t.artist ? `${t.artist} - ` : ''}${t.title}`);
    lines.push(path);
  }
  return { fileName: `${safeName(opts.playlistName)}.m3u8`, mime: 'audio/x-mpegurl', data: lines.join('\n') + '\n' };
}

/** RFC-4180-ish CSV parser that also handles tab / semicolon separated files. */
export function parseDelimited(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = [',', '\t', ';'].sort((a, b) => count(firstLine, b) - count(firstLine, a))[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function count(s: string, ch: string): number {
  return s.split(ch).length - 1;
}

const COLUMN_ALIASES: Record<string, string[]> = {
  title: ['title', 'name', 'track', 'track title', 'song', 'track name'],
  artist: ['artist', 'artists', 'track artist'],
  bpm: ['bpm', 'tempo'],
  key: ['key', 'musical key', 'tonality', 'initial key'],
  genre: ['genre'],
  album: ['album'],
  label: ['label', 'publisher'],
  path: ['location', 'path', 'file', 'filename', 'file path', 'file name'],
  duration: ['duration', 'length', 'time', 'playtime', 'total time'],
  comment: ['comment', 'comments', 'notes'],
};

export function looksLikeCsv(text: string): boolean {
  const rows = parseDelimited(text.split(/\r?\n/).slice(0, 10).join('\n'));
  return rows.some((r) => r.length > 1 && findHeader(r) !== null);
}

function findHeader(row: string[]): Record<string, number> | null {
  const map: Record<string, number> = {};
  row.forEach((cell, i) => {
    const c = cell.trim().toLowerCase();
    for (const [field, names] of Object.entries(COLUMN_ALIASES)) {
      if (map[field] === undefined && names.includes(c)) map[field] = i;
    }
  });
  return map.title !== undefined || map.path !== undefined ? map : null;
}

export function importCsv(text: string, name: string, source: SourceFormat = 'csv'): ImportResult {
  const rows = parseDelimited(text);
  // Serato history exports put session info above the real header; scan for it.
  let headerIdx = -1;
  let header: Record<string, number> | null = null;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    header = findHeader(rows[i]);
    if (header) {
      headerIdx = i;
      break;
    }
  }
  if (!header) throw new Error('Could not find a header row with a title or file column');

  const get = (r: string[], f: string) => {
    const i = header![f];
    const v = i === undefined ? undefined : r[i]?.trim();
    return v ? v : undefined;
  };
  const tracks: Track[] = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const path = get(r, 'path');
    let title = get(r, 'title');
    let artist = get(r, 'artist');
    if (!title && path) ({ title, artist } = { ...guessFromFileName(path), ...(artist ? { artist } : {}) });
    if (!title) continue;
    const bpm = Number(get(r, 'bpm'));
    const durRaw = get(r, 'duration');
    tracks.push({
      id: uid('trk'),
      title,
      artist: artist ?? '',
      bpm: Number.isFinite(bpm) && bpm > 0 ? bpm : undefined,
      key: normaliseKey(get(r, 'key')),
      genre: get(r, 'genre'),
      album: get(r, 'album'),
      label: get(r, 'label'),
      comment: get(r, 'comment'),
      duration: durRaw ? parseTime(durRaw) : undefined,
      path,
      cues: [],
      source,
    });
  }
  return {
    format: source,
    tracks,
    playlists: [{ id: uid('pl'), name, trackIds: tracks.map((t) => t.id), source }],
    warnings: [],
  };
}

/** "01. Artist - Title [Label]" per line. */
export function importPlainTracklist(text: string, name: string): ImportResult {
  const tracks: Track[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    line = line
      .replace(/^\[?\d{1,2}:\d{2}(:\d{2})?\]?\s*/, '') // timestamps
      .replace(/^\d{1,3}[.)]\s*/, '') // numbering
      .trim();
    let label: string | undefined;
    const lm = /\s*\[([^\]]+)\]\s*$/.exec(line);
    if (lm) {
      label = lm[1];
      line = line.slice(0, lm.index).trim();
    }
    const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(line);
    tracks.push({
      id: uid('trk'),
      title: m ? m[2] : line,
      artist: m ? m[1] : '',
      label,
      cues: [],
      source: 'manual',
    });
  }
  return {
    format: 'manual',
    tracks,
    playlists: [{ id: uid('pl'), name, trackIds: tracks.map((t) => t.id), source: 'manual' }],
    warnings: [],
  };
}
