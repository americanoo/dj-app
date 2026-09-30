import type { Playlist, SourceFormat, Track } from '../model';

export interface ImportResult {
  format: SourceFormat;
  tracks: Track[];
  playlists: Playlist[];
  warnings: string[];
}

export interface ExportOptions {
  /** Name of the playlist written into the export. */
  playlistName: string;
  /** Rewrite path prefixes, e.g. moving a library from one machine to another. */
  pathFrom?: string;
  pathTo?: string;
  /** Traktor needs a volume name for macOS paths on the boot disk. */
  macVolumeName?: string;
}

export interface ExportFile {
  fileName: string;
  mime: string;
  data: string | Uint8Array;
}

export function applyPathRewrite(path: string | undefined, opts: Pick<ExportOptions, 'pathFrom' | 'pathTo'>) {
  if (!path || !opts.pathFrom) return path;
  const p = path.replace(/\\/g, '/');
  const from = opts.pathFrom.replace(/\\/g, '/');
  return p.startsWith(from) ? (opts.pathTo ?? '').replace(/\\/g, '/') + p.slice(from.length) : path;
}
