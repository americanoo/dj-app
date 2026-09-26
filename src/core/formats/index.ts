import type { Track } from '../model';
import { exportRekordbox, importRekordbox, isRekordboxXml } from './rekordbox';
import { exportSeratoCrate, importSeratoCrate, isSeratoCrate } from './serato';
import { exportM3u, importCsv, importM3u, importPlainTracklist, looksLikeCsv } from './text';
import { exportTraktor, importTraktor, isTraktorNml } from './traktor';
import type { ExportFile, ExportOptions, ImportResult } from './types';

export type { ExportFile, ExportOptions, ImportResult } from './types';

/** Detect the format from name + content and import it. */
export function importFile(name: string, bytes: Uint8Array): ImportResult {
  const base = name.replace(/\.[^.]+$/, '');
  const ext = (/\.([^.]+)$/.exec(name)?.[1] ?? '').toLowerCase();

  if (ext === 'crate' || isSeratoCrate(bytes)) return importSeratoCrate(bytes, base);

  const text = decodeText(bytes);
  if (isRekordboxXml(text)) return importRekordbox(text);
  if (isTraktorNml(text)) return importTraktor(text);
  if (ext === 'm3u' || ext === 'm3u8' || text.trimStart().startsWith('#EXTM3U')) return importM3u(text, base);
  if (ext === 'csv' || ext === 'tsv' || looksLikeCsv(text)) {
    const source = /serato/i.test(name) ? 'serato' : /djay/i.test(name) ? 'djay' : 'csv';
    return importCsv(text, base, source);
  }
  if (ext === 'txt' || ext === '') return importPlainTracklist(text, base);
  throw new Error(`Don't know how to read "${name}"`);
}

function decodeText(bytes: Uint8Array): string {
  // UTF-16 BOMs (some Windows exports), otherwise UTF-8.
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
}

export type ExportTarget = 'rekordbox' | 'traktor' | 'serato' | 'djay' | 'm3u8';

export interface ExportTargetInfo {
  id: ExportTarget;
  label: string;
  carriesCues: boolean;
  howToImport: string[];
}

export const EXPORT_TARGETS: ExportTargetInfo[] = [
  {
    id: 'rekordbox',
    label: 'rekordbox (XML)',
    carriesCues: true,
    howToImport: [
      'rekordbox → Preferences → Advanced → Database → rekordbox xml: choose the exported file.',
      'In the tree view open "rekordbox xml", right-click the playlist → Import Playlist.',
      'Tracks already in your collection keep their existing cues unless you remove them first; new tracks arrive with your hot cues, memory cues and loops.',
    ],
  },
  {
    id: 'traktor',
    label: 'Traktor Pro (NML)',
    carriesCues: true,
    howToImport: [
      'Traktor → Browser → right-click "Playlists" → Import Playlist, and choose the .nml file.',
      'To merge cues into tracks already in your collection use File → Import Another Collection instead.',
      'Hot cues map to pads 1-8, loops become saved loops. Traktor ignores cue colours.',
    ],
  },
  {
    id: 'serato',
    label: 'Serato DJ (crate)',
    carriesCues: false,
    howToImport: [
      'Copy the .crate file into the _Serato_/Subcrates folder of the drive that holds the music (Music/_Serato_ on your system drive).',
      'Serato keeps cue points inside the audio files, so a crate carries track order only. To bring cues across, also export for rekordbox and use Serato\'s rekordbox library import (available in recent Serato DJ Pro versions; check your version\'s Library settings).',
    ],
  },
  {
    id: 'djay',
    label: 'djay Pro (via rekordbox XML)',
    carriesCues: true,
    howToImport: [
      'djay Pro reads rekordbox XML libraries, including hot cues and loops.',
      'Enable rekordbox in djay Pro\'s library sources and point it at the exported file (menu names vary between djay versions).',
      'If your djay version doesn\'t show rekordbox, use the M3U8 export for the playlist order instead.',
    ],
  },
  {
    id: 'm3u8',
    label: 'M3U8 playlist (any software)',
    carriesCues: false,
    howToImport: ['Drag the .m3u8 file into your DJ software\'s playlist panel. Order only; no cues.'],
  },
];

/** Shift every position by `offsetMs` (to compensate MP3 decoder differences between programs). */
export function shiftTrack(t: Track, offsetMs: number): Track {
  if (!offsetMs) return t;
  const d = offsetMs / 1000;
  const clamp = (x: number) => Math.max(0, x + d);
  return {
    ...t,
    gridStart: t.gridStart !== undefined ? clamp(t.gridStart) : undefined,
    beatGrid: t.beatGrid?.map((g) => ({ ...g, position: clamp(g.position) })),
    cues: t.cues.map((c) => ({ ...c, start: clamp(c.start), end: c.end !== undefined ? clamp(c.end) : undefined })),
  };
}

export function exportFor(
  target: ExportTarget,
  tracks: Track[],
  playlistTrackIds: string[],
  opts: ExportOptions & { offsetMs?: number },
): { file: ExportFile; notes: string[] } {
  const shifted = tracks.map((t) => shiftTrack(t, opts.offsetMs ?? 0));
  const playlists = [{ name: opts.playlistName, trackIds: playlistTrackIds }];
  const byId = new Map(shifted.map((t) => [t.id, t]));
  const ordered = playlistTrackIds.map((id) => byId.get(id)).filter((t): t is Track => !!t);
  const notes: string[] = [];
  const missingPath = ordered.filter((t) => !t.path);
  if (missingPath.length) {
    notes.push(
      `${missingPath.length} track(s) have no file location and were left out: ` +
        missingPath
          .slice(0, 5)
          .map((t) => `${t.artist} - ${t.title}`)
          .join(', ') +
        (missingPath.length > 5 ? '…' : ''),
    );
  }

  switch (target) {
    case 'rekordbox':
      return { file: exportRekordbox(shifted.filter((t) => t.path), playlists, opts), notes };
    case 'djay': {
      const file = exportRekordbox(shifted.filter((t) => t.path), playlists, opts);
      return { file: { ...file, fileName: file.fileName.replace('.rekordbox.xml', '.djay-rekordbox.xml') }, notes };
    }
    case 'traktor':
      return { file: exportTraktor(shifted, playlists, opts), notes };
    case 'serato': {
      const file = exportSeratoCrate(ordered, opts);
      if (file.drives.length > 1) {
        notes.push(
          `Tracks live on several drives (${file.drives.join(', ')}). Serato expects one crate per drive; the crate paths are relative to each drive root.`,
        );
      }
      return { file, notes };
    }
    case 'm3u8':
      return { file: exportM3u(ordered, opts), notes };
  }
}
