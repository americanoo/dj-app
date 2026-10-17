// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyLicense } from '../license';

const root = join(__dirname, '..', '..', '..');

describe('seller script (scripts/license.mjs)', () => {
  it('sets up a signing key and issues numbered keys the app accepts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'setcraft-keys-'));
    const config = join(dir, 'config.ts');
    copyFileSync(join(root, 'src', 'config.ts'), config);
    const env = { ...process.env, SETCRAFT_KEY_DIR: dir, SETCRAFT_CONFIG: config };
    const run = (...args: string[]) => execFileSync('node', [join(root, 'scripts', 'license.mjs'), ...args], { env, encoding: 'utf8' });

    run('setup');
    const pub = /publicKey: '([^']+)'/.exec(readFileSync(config, 'utf8'))?.[1] ?? '';
    expect(pub).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // running setup again keeps the same key
    run('setup');
    expect(readFileSync(config, 'utf8')).toContain(pub);

    const first = /^(SC1\.\S+)$/m.exec(run('new', 'DJ One', 'one@example.com'))?.[1] ?? '';
    const second = /^(SC1\.\S+)$/m.exec(run('new', 'DJ Two'))?.[1] ?? '';
    const a = await verifyLicense(first, pub);
    const b = await verifyLicense(second, pub);
    expect(a).toMatchObject({ ok: true, info: { n: 'DJ One', e: 'one@example.com', no: 1 } });
    expect(b).toMatchObject({ ok: true, info: { n: 'DJ Two', no: 2 } });
    expect(run('list')).toContain('#2');
  });
});
