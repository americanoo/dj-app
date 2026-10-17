#!/usr/bin/env node
/**
 * Setcraft helper: runs on the computer that holds your music.
 *
 *   npm run setcraft            (builds the app, then starts the helper)
 *   npm run helper -- --music "/Volumes/My Drive/Music"
 *
 * It serves the Setcraft app to every device on your Wi-Fi (like `vite preview`)
 * and hands each one the audio of your tracks, read straight from wherever your
 * DJ software says they are: your Music folder, an external drive, anywhere.
 * Nothing is copied or uploaded.
 *
 * Safety: it only ever reads audio files (never anything else), only inside your
 * home folder, /Volumes and any --music folders, and only for devices paired
 * with the link it prints (the computer itself needs no pairing). It never
 * writes anything except its own pairing key in ~/.setcraft-helper.json.
 *
 * Options:
 *   --port <n>        port to listen on (default 4173)
 *   --music <folder>  also look in this folder (and its subfolders) for tracks
 *                     whose saved location no longer exists, by name. Repeatable.
 *   --app <folder>    the built app to serve (default: dist next to this script)
 */
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir, hostname, networkInterfaces } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildIndex, findTrackFile } from '../src/core/pathmatch.ts';

export const HELPER_VERSION = 1;

const AUDIO = /\.(mp3|wav|aiff?|flac|m4a|mp4|aac|ogg|opus)$/i;
const AUDIO_TYPES = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
};
const APP_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

/** The pairing key, made once and kept, so a paired phone stays paired across restarts. */
export function loadToken(file = join(homedir(), '.setcraft-helper.json')) {
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof saved.token === 'string' && saved.token.length >= 32) return saved.token;
  } catch {
    // first run
  }
  const token = randomBytes(16).toString('hex');
  try {
    writeFileSync(file, JSON.stringify({ token }, null, 2), { mode: 0o600 });
  } catch {
    // read-only home: the key just lasts this run
  }
  return token;
}

const isLoopback = (addr = '') => addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';

function sameToken(a, b) {
  if (typeof a !== 'string' || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

const inside = (file, root) => file === root || file.startsWith(root.endsWith(sep) ? root : root + sep);

/** Every audio file under `root`, as paths relative to it. Hidden folders and DJ-software databases are skipped. */
async function walk(root, rel = '', out = []) {
  let entries;
  try {
    entries = await readdir(join(root, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (/^(_Serato_|PIONEER)$/i.test(e.name)) continue;
      await walk(root, r, out);
    } else if (AUDIO.test(e.name)) out.push(r);
  }
  return out;
}

/**
 * The helper's HTTP server (not yet listening).
 * `trustLoopback`: requests from this computer need no pairing (off in tests).
 */
export async function createHelper({ token, app, music = [], roots, trustLoopback = true, log = () => {} }) {
  const musicRoots = await Promise.all(music.map((m) => realpath(resolve(m)).catch(() => resolve(m))));
  const allowed = await Promise.all(
    (roots ?? [homedir(), '/Volumes']).map((r) => realpath(r).catch(() => r)),
  );
  allowed.push(...musicRoots);

  // Index the --music folders in the background, for tracks whose saved location is gone.
  const index = { byRoot: [] };
  const indexing = Promise.all(
    musicRoots.map(async (root) => {
      const files = await walk(root);
      index.byRoot.push({ root, idx: buildIndex(files) });
      log(`Indexed ${files.length} audio files in ${root}`);
    }),
  );

  const audioFile = async (q) => {
    const wanted = q.get('path') || '';
    if (wanted) {
      try {
        const real = await realpath(wanted);
        if (AUDIO.test(real) && allowed.some((r) => inside(real, r))) return real;
      } catch {
        // gone or renamed: look for it by name below
      }
    }
    await indexing;
    const ref = { path: wanted || undefined, artist: q.get('artist') || undefined, title: q.get('title') || undefined };
    for (const { root, idx } of index.byRoot) {
      const rel = findTrackFile(ref, idx);
      if (rel) return join(root, rel);
    }
    return undefined;
  };

  const sendFile = async (req, res, file, type, cache) => {
    const info = await stat(file);
    const headers = { 'Content-Type': type, 'Cache-Control': cache, 'Accept-Ranges': 'bytes' };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
      if (start > end || start >= info.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }).end();
        return;
      }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') return void res.end();
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': info.size });
    if (req.method === 'HEAD') return void res.end();
    createReadStream(file).pipe(res);
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://helper');
      if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405).end();
      const paired = (trustLoopback && isLoopback(req.socket.remoteAddress)) || sameToken(req.headers['x-setcraft-token'], token);

      if (url.pathname === '/helper/status') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return void res.end(JSON.stringify({ ok: true, version: HELPER_VERSION, name: hostname(), paired }));
      }
      if (url.pathname === '/helper/file') {
        if (!paired) return void res.writeHead(401, { 'Content-Type': 'text/plain' }).end('Not paired');
        const file = await audioFile(url.searchParams);
        if (!file) return void res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
        return void (await sendFile(req, res, file, AUDIO_TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'no-store'));
      }
      if (url.pathname.startsWith('/helper/')) return void res.writeHead(404).end();

      // The app itself, with every unknown path going to index.html.
      if (!app) return void res.writeHead(404).end();
      const root = resolve(app);
      let file = resolve(root, '.' + decodeURIComponent(url.pathname));
      if (!inside(file, root)) return void res.writeHead(403).end();
      const info = await stat(file).catch(() => undefined);
      if (!info || info.isDirectory()) file = join(root, 'index.html');
      const ext = extname(file).toLowerCase();
      const hashed = file.includes(`${sep}assets${sep}`);
      return void (await sendFile(req, res, file, APP_TYPES[ext] || 'application/octet-stream', hashed ? 'public, max-age=31536000, immutable' : 'no-cache'));
    } catch (e) {
      log(`Error: ${e?.message ?? e}`);
      if (!res.headersSent) res.writeHead(500).end();
      else res.destroy();
    }
  });
  server.indexing = indexing;
  return server;
}

function parseArgs(argv) {
  const opts = { port: 4173, music: [], app: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') opts.port = Number(argv[++i]);
    else if (a === '--music') opts.music.push(argv[++i]);
    else if (a === '--app') opts.app = argv[++i];
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
    return;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const app = opts.app ?? join(here, '..', 'dist');
  if (!existsSync(join(app, 'index.html'))) {
    console.error(`No built app in ${app}. Run "npm run build" first (or "npm run setcraft", which does both).`);
    process.exit(1);
  }
  const token = loadToken();
  const server = await createHelper({ token, app, music: opts.music, log: (m) => console.log(m) });
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${opts.port} is busy: stop the other server, or use --port.` : e.message);
    process.exit(1);
  });
  server.listen(opts.port, '0.0.0.0', () => {
    console.log(`\n  Setcraft helper is running. Keep this window open.\n`);
    console.log(`  On this computer:   http://localhost:${opts.port}/`);
    for (const ip of lanAddresses()) console.log(`  On your phone:      http://${ip}:${opts.port}/?pair=${token}`);
    console.log(`\n  Open the phone link once (same Wi-Fi): it pairs the phone, then your tracks play`);
    console.log(`  straight from this computer's drives. Treat that link like a password.\n`);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
