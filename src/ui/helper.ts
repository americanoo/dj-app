import type { TrackRef } from '../core/pathmatch';

/**
 * The Setcraft helper (helper/setcraft-helper.mjs), when it's the one serving
 * this page: it hands over each track's audio straight from the computer's
 * drives, by the location the DJ software saved. A phone pairs once by opening
 * the link the helper prints (…/?pair=<key>); the computer itself needs no key.
 */

const TOKEN_KEY = 'setcraft-helper-token';

export interface HelperInfo {
  name: string;
  /** This device may fetch music (paired, or the computer itself). */
  paired: boolean;
}

/** Takes the pairing key from the address (once), keeps it, and tidies the address. */
function pairFromAddress() {
  try {
    const url = new URL(window.location.href);
    const pair = url.searchParams.get('pair');
    if (!pair) return;
    localStorage.setItem(TOKEN_KEY, pair);
    url.searchParams.delete('pair');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch {
    // storage unavailable: pairing lasts this visit only (the key stays in the address)
  }
}

function token(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? new URL(window.location.href).searchParams.get('pair') ?? '';
  } catch {
    return '';
  }
}

const headers = () => ({ 'x-setcraft-token': token() });

/** Is the helper serving this page? Quick: a page from anywhere else answers 404 or not at all. */
export async function detectHelper(): Promise<HelperInfo | null> {
  if (typeof window === 'undefined' || !/^https?:$/.test(window.location.protocol)) return null;
  pairFromAddress();
  try {
    const ctl = new AbortController();
    const timer = window.setTimeout(() => ctl.abort(), 2500);
    const res = await fetch('/helper/status', { headers: headers(), signal: ctl.signal, cache: 'no-store' });
    window.clearTimeout(timer);
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null;
    const s = (await res.json()) as { ok?: boolean; name?: string; paired?: boolean };
    return s.ok ? { name: s.name || 'your computer', paired: !!s.paired } : null;
  } catch {
    return null;
  }
}

/** A track's audio from the helper, or undefined if it can't find it. */
export async function helperFile(track: TrackRef): Promise<File | undefined> {
  if (!track.path && !(track.artist && track.title)) return undefined;
  const q = new URLSearchParams();
  if (track.path) q.set('path', track.path);
  if (track.artist) q.set('artist', track.artist);
  if (track.title) q.set('title', track.title);
  try {
    const res = await fetch(`/helper/file?${q}`, { headers: headers(), cache: 'no-store' });
    if (!res.ok) return undefined;
    const blob = await res.blob();
    const name = track.path?.split(/[\\/]/).pop() || `${track.artist} - ${track.title}`;
    return new File([blob], name, { type: blob.type });
  } catch {
    return undefined;
  }
}
