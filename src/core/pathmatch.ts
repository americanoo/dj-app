/**
 * Find a track's audio file inside a linked music folder.
 *
 * The browser only gives us paths relative to the folder the DJ picked, while
 * library exports hold absolute paths from the DJ software. Files are matched
 * by name. When several files share a name, the one whose parent folders match
 * the most trailing segments of the library path wins.
 */

export interface FileIndex {
  /** normalised file name -> relative paths inside the linked folder */
  byName: Map<string, string[]>;
  count: number;
}

/** Case-insensitive, and macOS (NFD) vs. export (NFC) accents compare equal. */
function norm(s: string): string {
  return s.normalize('NFC').toLowerCase();
}

function segments(path: string): string[] {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).map(norm);
}

export function buildIndex(relPaths: Iterable<string>): FileIndex {
  const byName = new Map<string, string[]>();
  let count = 0;
  for (const rel of relPaths) {
    const name = segments(rel).pop();
    if (!name) continue;
    const list = byName.get(name);
    if (list) list.push(rel);
    else byName.set(name, [rel]);
    count++;
  }
  return { byName, count };
}

export function resolveTrackFile(trackPath: string | undefined, index: FileIndex): string | undefined {
  if (!trackPath) return undefined;
  const want = segments(trackPath);
  const name = want[want.length - 1];
  const candidates = name ? index.byName.get(name) : undefined;
  if (!candidates?.length) return undefined;
  if (candidates.length === 1) return candidates[0];

  let best: string | undefined;
  let bestScore = -1;
  for (const rel of candidates) {
    const have = segments(rel);
    let score = 0;
    while (
      score < have.length &&
      score < want.length &&
      have[have.length - 1 - score] === want[want.length - 1 - score]
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
