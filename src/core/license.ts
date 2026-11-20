/**
 * Founding DJ licence keys.
 *
 * A key is `SC1.<payload>.<signature>`: the payload is base64url JSON naming
 * the DJ, and the signature is Ed25519 over the payload text, made with a
 * private key only the seller has (scripts/license.mjs). The app checks it
 * offline with the matching public key, so there's no server and a key works
 * forever, on any browser.
 *
 * Like any check in a web page, a determined person could patch it out; it's
 * there to keep honest people honest, not as DRM.
 */

export interface LicenseInfo {
  /** Key format version. */
  v: 1;
  /** The DJ's name, as they want it shown. */
  n: string;
  /** Buyer email. */
  e?: string;
  /** Founding DJ number. */
  no?: number;
  /** Issue date, YYYY-MM-DD. */
  iat: string;
}

const PREFIX = 'SC1.';

export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The payload segment of a key for this info (what gets signed). */
export function encodePayload(info: LicenseInfo): string {
  return base64url(new TextEncoder().encode(JSON.stringify(info)));
}

/** Assemble a key from a payload segment and its signature. */
export function formatKey(payload: string, signature: Uint8Array): string {
  return `${PREFIX}${payload}.${base64url(signature)}`;
}

/** Keys get pasted from emails: tolerate spaces, line breaks and quotes around them. */
export function cleanKey(input: string): string {
  return input.replace(/[\s"'`]/g, '');
}

export type LicenseCheck = { ok: true; info: LicenseInfo } | { ok: false; reason: string };

/** Verify a key against the seller's public key (32 raw bytes, base64url). */
export async function verifyLicense(input: string, publicKey: string): Promise<LicenseCheck> {
  const key = cleanKey(input);
  if (!publicKey) return { ok: false, reason: 'This copy of Setcraft isn’t set up to check keys yet.' };
  if (!key.startsWith(PREFIX)) return { ok: false, reason: 'That doesn’t look like a Setcraft key (it starts with SC1.).' };
  const [payload, sig] = key.slice(PREFIX.length).split('.');
  if (!payload || !sig) return { ok: false, reason: 'The key is incomplete. Copy the whole line from the email.' };
  let info: LicenseInfo;
  try {
    info = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as LicenseInfo;
  } catch {
    return { ok: false, reason: 'The key is damaged. Copy the whole line from the email.' };
  }
  let signature: Uint8Array;
  try {
    signature = fromBase64url(sig);
  } catch {
    return { ok: false, reason: 'The key is damaged. Copy the whole line from the email, and only that line.' };
  }
  if (signature.length !== 64) return { ok: false, reason: 'This key isn’t valid. Copy the whole line from the email, and only that line.' };
  const subtle = globalThis.crypto?.subtle;
  // Browsers only offer signature checks on https:// pages (and localhost).
  if (!subtle) return { ok: false, reason: 'Open Setcraft over https:// (or on localhost) to activate your key.' };
  try {
    const pub = await subtle.importKey('raw', fromBase64url(publicKey) as BufferSource, { name: 'Ed25519' }, false, ['verify']);
    const good = await subtle.verify({ name: 'Ed25519' }, pub, signature as BufferSource, new TextEncoder().encode(payload) as BufferSource);
    if (!good) return { ok: false, reason: 'This key isn’t valid. Check you copied all of it.' };
  } catch {
    return { ok: false, reason: 'Your browser couldn’t check the key. Try an up-to-date Chrome, Safari, Edge or Firefox.' };
  }
  if (info.v !== 1 || !info.n) return { ok: false, reason: 'This key is from a newer version of Setcraft.' };
  return { ok: true, info };
}
