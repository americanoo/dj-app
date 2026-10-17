/**
 * Find a track's audio file inside a linked music folder (or the music kept
 * on this device).
 *
 * The browser only gives us paths relative to the folder the DJ picked, while
 * library exports hold absolute paths from the DJ software, often on another
 * drive. Files are matched by name. When several files share a name, the one
 * whose parent folders match the most trailing segments of the library path
 * wins.
 *
 * When the exact name isn't there (a copy converted to another format, a
 * track number added, underscores for spaces), a loose match on the name
 * without extension, numbering or punctuation is tried, then the track's
 * "Artist - Title".
 */

export interface FileIndex {
  /** normalised file name -> relative paths inside the linked folder */
  byName: Map<string, string[]>;
  /** loose name (see looseKey) -> relative paths */
  byLoose: Map<string, string[]>;
  count: number;
}

/** What a track offers for finding its file. */
export interface TrackRef {
  path?: string;
  artist?: string;
  title?: string;
}

/** Case-insensitive, and macOS (NFD) vs. export (NFC) accents compare equal. */
function norm(s: string): string {
  return s.normalize('NFC').toLowerCase();
}

function segments(path: string): string[] {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).map(norm);
}

/**
 * A song's name with everything that differs between copies taken out: case,
 * extension, a leading track number ("01 - ", "1. "), underscores and other
 * punctuation. "01_DJ_Alpha-Opening_Theme.m4a" and "DJ Alpha - Opening Theme.mp3"
 * both become "dj alpha opening theme".
 */
export function looseKey(name: string): string {
  return norm(name)
    .replace(/\.[a-z0-9]{2,5}$/, '')
    .replace(/^(\d{1,3}\s*[-._)]\s*|\d{2}\s+)/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function add(map: Map<string, string[]>, key: string, rel: string) {
  if (!key) return;
  const list = map.get(key);
  if (list) list.push(rel);
  else map.set(key, [rel]);
}

export function buildIndex(relPaths: Iterable<string>): FileIndex {
  const byName = new Map<string, string[]>();
  const byLoose = new Map<string, string[]>();
  let count = 0;
  for (const rel of relPaths) {
    const name = segments(rel).pop();
    if (!name) continue;
    add(byName, name, rel);
    add(byLoose, looseKey(name), rel);
    count++;
  }
  return { byName, byLoose, count };
}

export function resolveTrackFile(trackPath: string | undefined, index: FileIndex): string | undefined {
  if (!trackPath) return undefined;
  const want = segments(trackPath);
  const name = want[want.length - 1];
  const candidates = name ? index.byName.get(name) : undefined;
  if (!candidates?.length) return undefined;
  if (candidates.length === 1) return candidates[0];

  return closest(candidates, want);
}

/** Of several files, the one whose parent folders match the most trailing segments of `want`. */
function closest(candidates: string[], want: string[]): string | undefined {
  let best: string | undefined;
  let bestScore = -1;
  for (const rel of candidates) {
    const have = segments(rel);
    // The file names may differ (loose matches), so compare from the parent folder up.
    let score = 0;
    while (
      score + 1 < have.length &&
      score + 1 < want.length &&
      have[have.length - 2 - score] === want[want.length - 2 - score]
    ) {
      score++;
    }
    if (score > bestScore) {
      best = rel;
      bestScore = score;
    }
  }
  return best;
}

/**
 * The file for a track: by exact file name first, then loosely by name, then by
 * "Artist - Title" (also the other way round), then by title alone inside a folder
 * named after the artist (Music/Artist/Album/01 Title.mp3).
 */
export function findTrackFile(track: TrackRef, index: FileIndex): string | undefined {
  const exact = resolveTrackFile(track.path, index);
  if (exact) return exact;
  const want = track.path ? segments(track.path) : [];
  const keys = [
    want.length ? looseKey(want[want.length - 1]) : '',
    track.artist && track.title ? looseKey(`${track.artist} - ${track.title}`) : '',
    track.artist && track.title ? looseKey(`${track.title} - ${track.artist}`) : '',
  ];
  for (const key of keys) {
    const candidates = key ? index.byLoose.get(key) : undefined;
    if (candidates?.length) return closest(candidates, want);
  }
  if (track.title && track.artist) {
    const artist = looseKey(track.artist);
    const inArtistFolder = (index.byLoose.get(looseKey(track.title)) ?? []).filter((rel) =>
      segments(rel).slice(0, -1).some((dir) => looseKey(dir) === artist),
    );
    if (inArtistFolder.length) return closest(inArtistFolder, want);
  }
  return undefined;
}
