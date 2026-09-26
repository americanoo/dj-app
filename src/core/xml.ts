/** Small XML + path helpers shared by the format adapters. */

export function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new Error('Not valid XML: ' + (err.textContent ?? '').slice(0, 200));
  return doc;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Strip control characters that are illegal in XML 1.0.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

/** Serialise attributes, skipping undefined / empty values. */
export function attrs(record: Record<string, string | number | undefined | null>): string {
  return Object.entries(record)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => ` ${k}="${escapeXml(String(v))}"`)
    .join('');
}

export function children(el: Element, tag: string): Element[] {
  return Array.from(el.children).filter((c) => c.tagName === tag);
}

export function child(el: Element, tag: string): Element | undefined {
  return children(el, tag)[0];
}

export function num(v: string | null | undefined): number | undefined {
  if (v === null || v === undefined || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function str(v: string | null | undefined): string | undefined {
  const s = v?.trim();
  return s ? s : undefined;
}

/** "file://localhost/Users/me/a%20b.mp3" -> "/Users/me/a b.mp3"; Windows drives become "C:/…". */
export function fileUrlToPath(url: string): string {
  let p = url.replace(/^file:\/\/(localhost)?/i, '');
  try {
    p = decodeURIComponent(p);
  } catch {
    // Leave malformed escapes as-is.
  }
  if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
  return p;
}

/** Inverse of {@link fileUrlToPath}, in the form rekordbox writes. */
export function pathToFileUrl(path: string): string {
  const p = path.replace(/\\/g, '/');
  const segments = p.split('/').map((seg, i) => {
    if (i === 0 && /^[A-Za-z]:$/.test(seg)) return seg;
    return encodeURIComponent(seg);
  });
  const joined = segments.join('/');
  return 'file://localhost' + (joined.startsWith('/') ? joined : '/' + joined);
}

export function fileName(path: string | undefined): string {
  if (!path) return '';
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1];
}

export function extension(path: string | undefined): string {
  const f = fileName(path);
  const i = f.lastIndexOf('.');
  return i >= 0 ? f.slice(i + 1).toLowerCase() : '';
}

/** "Artist - Title.mp3" -> { artist, title } fallback for files without tags. */
export function guessFromFileName(path: string): { artist: string; title: string } {
  const base = fileName(path).replace(/\.[^.]+$/, '');
  const m = /^(.+?)\s+-\s+(.+)$/.exec(base);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: base };
}
