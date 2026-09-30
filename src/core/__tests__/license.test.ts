// @vitest-environment node
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { base64url, encodePayload, formatKey, verifyLicense, type LicenseInfo } from '../license';

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  // The raw 32-byte key is the tail of the DER encoding.
  const raw = new Uint8Array(publicKey.export({ format: 'der', type: 'spki' })).slice(-32);
  return { pub: base64url(raw), privateKey };
}

function issue(info: LicenseInfo, privateKey: ReturnType<typeof keypair>['privateKey']) {
  const payload = encodePayload(info);
  return formatKey(payload, new Uint8Array(sign(null, Buffer.from(payload), privateKey)));
}

const info: LicenseInfo = { v: 1, n: 'DJ Canoo', e: 'dj@example.com', no: 7, iat: '2026-09-29' };

describe('founding DJ keys', () => {
  it('accepts a key signed with the matching private key', async () => {
    const { pub, privateKey } = keypair();
    const res = await verifyLicense(issue(info, privateKey), pub);
    expect(res).toEqual({ ok: true, info });
  });

  it('accepts keys pasted with spaces, line breaks or quotes', async () => {
    const { pub, privateKey } = keypair();
    const key = issue(info, privateKey);
    const messy = `  "${key.slice(0, 40)}\n${key.slice(40)}" `;
    expect((await verifyLicense(messy, pub)).ok).toBe(true);
  });

  it('rejects edited keys, other sellers’ keys and junk', async () => {
    const { pub, privateKey } = keypair();
    const key = issue(info, privateKey);
    // someone changes the name in the payload
    const forged = key.replace(encodePayload(info), encodePayload({ ...info, n: 'Someone else' }));
    expect((await verifyLicense(forged, pub)).ok).toBe(false);
    // signed by a different key
    expect((await verifyLicense(issue(info, keypair().privateKey), pub)).ok).toBe(false);
    expect((await verifyLicense('hello', pub)).ok).toBe(false);
    expect((await verifyLicense('SC1.abc', pub)).ok).toBe(false);
  });

  it('says so when no public key is configured', async () => {
    const res = await verifyLicense('SC1.a.b', '');
    expect(res.ok).toBe(false);
  });
});
