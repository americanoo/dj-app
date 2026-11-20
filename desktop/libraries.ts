/** DJ-software libraries found on this Mac, to offer a one-click import. */
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface FoundLibrary {
  kind: 'traktor';
  /** e.g. "Traktor Pro 4.1" (the folder Traktor keeps it in). */
  name: string;
  path: string;
  modified: number;
}

/** Traktor's collection.nml in Documents/Native Instruments/Traktor *, newest first. */
export async function findLibraries(home = homedir()): Promise<FoundLibrary[]> {
  const base = join(home, 'Documents', 'Native Instruments');
  const out: FoundLibrary[] = [];
  let dirs: string[] = [];
  try {
    dirs = (await readdir(base)).filter((d) => /^Traktor/i.test(d));
  } catch {
    return out;
  }
  for (const d of dirs) {
    const path = join(base, d, 'collection.nml');
    try {
      const st = await stat(path);
      out.push({ kind: 'traktor', name: d.replace(/^Traktor\s*/i, 'Traktor Pro ').trim(), path, modified: st.mtimeMs });
    } catch {
      // that version has no collection
    }
  }
  return out.sort((a, b) => b.modified - a.modified);
}
