/**
 * Scanning music folders (desktop app, main process): every audio file with a
 * fingerprint and what its tags say. A cache keyed by path, size and change time
 * makes rescans quick: only new or changed files are read again.
 */
import { createHash } from 'node:crypto';
import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScanEntry } from '../src/core/musiclib';

export const AUDIO = /\.(mp3|wav|aiff?|flac|m4a|mp4|aac|ogg|opus)$/i;
const CHUNK = 64 * 1024;

/** A file's fingerprint: its size and a hash of its first and last 64 KB. Survives moves and renames. */
export async function fingerprint(path: string, size: number): Promise<string> {
  const fh = await open(path, 'r');
  try {
    const head = Buffer.alloc(Math.min(CHUNK, size));
    await fh.read(head, 0, head.length, 0);
    const tailLen = Math.min(CHUNK, Math.max(0, size - head.length));
    const tail = Buffer.alloc(tailLen);
    if (tailLen) await fh.read(tail, 0, tailLen, size - tailLen);
    return createHash('sha1').update(String(size)).update(head).update(tail).digest('hex').slice(0, 24);
  } finally {
    await fh.close();
  }
}

/** Every audio file under `root`. Hidden folders and DJ-software databases (_Serato_, PIONEER) are skipped. */
export async function listAudio(root: string, out: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const p = join(root, e.name);
    if (e.isDirectory()) {
      if (!/^(_Serato_|PIONEER)$/i.test(e.name)) await listAudio(p, out);
    } else if (AUDIO.test(e.name)) out.push(p);
  }
  return out;
}

export type TagReader = (path: string) => Promise<Partial<ScanEntry>>;
export interface ScanProgress {
  done: number;
  total: number;
  folder: string;
}

/**
 * Scan the folders. `cache` (from the last scan) is reused for files that haven't
 * changed; the returned cache replaces it. Unreadable files are skipped.
 */
export async function scanFolders(
  folders: string[],
  cache: Record<string, ScanEntry>,
  readTags: TagReader,
  onProgress?: (p: ScanProgress) => void,
): Promise<{ entries: ScanEntry[]; cache: Record<string, ScanEntry> }> {
  const lists = await Promise.all(folders.map(async (f) => ({ folder: f, files: await listAudio(f) })));
  const total = lists.reduce((n, l) => n + l.files.length, 0);
  const entries: ScanEntry[] = [];
  const next: Record<string, ScanEntry> = {};
  let done = 0;
  for (const { folder, files } of lists) {
    for (const path of files) {
      done++;
      try {
        const st = await stat(path);
        const hit = cache[path];
        let e: ScanEntry;
        if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) e = hit;
        else {
          const tags = await readTags(path).catch(() => ({}));
          e = { ...tags, path, size: st.size, mtimeMs: st.mtimeMs, fileId: await fingerprint(path, st.size) };
        }
        entries.push(e);
        next[path] = e;
      } catch {
        // vanished or unreadable mid-scan
      }
      if (onProgress && (done % 25 === 0 || done === total)) onProgress({ done, total, folder });
    }
  }
  return { entries, cache: next };
}
