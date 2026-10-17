// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHelper } from '../setcraft-helper.mjs';

const token = 'a'.repeat(32);
let base = '';
let close = () => {};
const dir = mkdtempSync(join(tmpdir(), 'setcraft-helper-'));
const music = join(dir, 'Music');
const app = join(dir, 'app');

beforeAll(async () => {
  mkdirSync(join(music, 'Techno'), { recursive: true });
  mkdirSync(join(app, 'assets'), { recursive: true });
  writeFileSync(join(music, 'Techno', 'Delta - Warehouse.wav'), 'RIFF-fake-audio-0123456789');
  writeFileSync(join(music, 'notes.txt'), 'secret');
  writeFileSync(join(app, 'index.html'), '<!doctype html><title>Setcraft</title>');
  writeFileSync(join(app, 'assets', 'app-abc.js'), 'console.log(1)');
  const server = await createHelper({ token, app, music: [music], roots: [], trustLoopback: false });
  await server.indexing;
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
afterAll(() => close());

const get = (path: string, headers: Record<string, string> = {}) => fetch(base + path, { headers });
const paired = { 'x-setcraft-token': token };
const file = (q: Record<string, string>) => '/helper/file?' + new URLSearchParams(q);

describe('the Setcraft helper', () => {
  it('says it is there, and whether this device is paired', async () => {
    expect(await (await get('/helper/status')).json()).toMatchObject({ ok: true, version: 1, paired: false });
    expect(await (await get('/helper/status', paired)).json()).toMatchObject({ paired: true });
  });

  it('hands audio only to paired devices', async () => {
    const path = join(music, 'Techno', 'Delta - Warehouse.wav');
    expect((await get(file({ path }))).status).toBe(401);
    expect((await get(file({ path }), { 'x-setcraft-token': 'b'.repeat(32) })).status).toBe(401);
    const res = await get(file({ path }), paired);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/wav');
    expect(await res.text()).toBe('RIFF-fake-audio-0123456789');
  });

  it('finds a track whose saved location is gone by its name, in the --music folders', async () => {
    const res = await get(file({ path: '/Volumes/OLD USB/DJ/Techno/Delta - Warehouse.wav' }), paired);
    expect(res.status).toBe(200);
    // Or by Artist - Title when the file name says nothing.
    expect((await get(file({ path: '/x/a8f3.mp3', artist: 'Delta', title: 'Warehouse' }), paired)).status).toBe(200);
    expect((await get(file({ path: '/x/Missing.mp3' }), paired)).status).toBe(404);
  });

  it('never reads anything that is not audio, or outside the allowed folders', async () => {
    expect((await get(file({ path: join(music, 'notes.txt') }), paired)).status).toBe(404);
    expect((await get(file({ path: '/etc/passwd' }), paired)).status).toBe(404);
  });

  it('serves a byte range, for players that stream', async () => {
    const res = await get(file({ path: join(music, 'Techno', 'Delta - Warehouse.wav') }), { ...paired, range: 'bytes=0-3' });
    expect(res.status).toBe(206);
    expect(await res.text()).toBe('RIFF');
  });

  it('serves the app, with unknown paths going to the page and nothing outside it', async () => {
    expect(await (await get('/')).text()).toContain('<title>Setcraft</title>');
    expect(await (await get('/some/route')).text()).toContain('<title>Setcraft</title>');
    const js = await get('/assets/app-abc.js');
    expect(js.headers.get('cache-control')).toContain('immutable');
    expect((await get('/..%2f..%2fetc%2fpasswd')).status).not.toBe(200);
  });
});
