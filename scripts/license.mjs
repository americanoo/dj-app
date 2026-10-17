#!/usr/bin/env node
/**
 * Founding DJ keys, for the seller. Runs on your computer only.
 *
 *   npm run license -- setup                         create your signing key (once) and put the public half in src/config.ts
 *   npm run license -- new "DJ Name" dj@email.com    issue a key for a buyer (numbered automatically)
 *   npm run license -- list                          everyone you've issued a key to
 *
 * The private signing key lives in ~/.setcraft (or $SETCRAFT_KEY_DIR), never in
 * the repo. Back it up: without it you can't issue keys that this app accepts.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.env.SETCRAFT_KEY_DIR || join(homedir(), '.setcraft');
const keyFile = join(dir, 'founding-signing-key.pem');
const logFile = join(dir, 'founding-keys-issued.json');
const configFile = process.env.SETCRAFT_CONFIG || join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'config.ts');

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function loadKey() {
  if (!existsSync(keyFile)) {
    console.error(`No signing key yet. Run:  npm run license -- setup`);
    process.exit(1);
  }
  return createPrivateKey(readFileSync(keyFile));
}

function publicKeyOf(privateKey) {
  // The raw 32-byte Ed25519 key is the tail of the DER encoding.
  const der = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  return b64url(der.subarray(der.length - 32));
}

function readLog() {
  return existsSync(logFile) ? JSON.parse(readFileSync(logFile, 'utf8')) : [];
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'setup') {
  mkdirSync(dir, { recursive: true });
  let privateKey;
  if (existsSync(keyFile)) {
    privateKey = loadKey();
    console.log(`Using your existing signing key: ${keyFile}`);
  } else {
    privateKey = generateKeyPairSync('ed25519').privateKey;
    writeFileSync(keyFile, privateKey.export({ format: 'pem', type: 'pkcs8' }));
    chmodSync(keyFile, 0o600);
    console.log(`Created your signing key: ${keyFile}`);
    console.log('Back this file up somewhere safe (a password manager is ideal). Keep it private.');
  }
  const pub = publicKeyOf(privateKey);
  const src = readFileSync(configFile, 'utf8');
  const next = src.replace(/publicKey: '[^']*'/, `publicKey: '${pub}'`);
  writeFileSync(configFile, next);
  console.log(`\nPublic key written to src/config.ts:\n  ${pub}`);
  console.log('\nNext: put your checkout link in src/config.ts (checkoutUrl), then commit src/config.ts.');
} else if (cmd === 'new') {
  const [name, email] = args.filter((a) => !a.startsWith('--'));
  const noArg = args.find((a) => a.startsWith('--no='));
  if (!name) {
    console.error('Usage: npm run license -- new "DJ Name" [email] [--no=12]');
    process.exit(1);
  }
  const privateKey = loadKey();
  const log = readLog();
  const no = noArg ? Number(noArg.slice(5)) : log.reduce((m, e) => Math.max(m, e.no ?? 0), 0) + 1;
  const info = { v: 1, n: name, ...(email ? { e: email } : {}), no, iat: new Date().toISOString().slice(0, 10) };
  const payload = b64url(Buffer.from(JSON.stringify(info)));
  const key = `SC1.${payload}.${b64url(sign(null, Buffer.from(payload), privateKey))}`;
  log.push({ ...info, key });
  writeFileSync(logFile, JSON.stringify(log, null, 2));
  console.log(`\nFounding DJ #${no}: ${name}${email ? ` <${email}>` : ''}\n`);
  console.log(key);
  console.log(`\n--- email to send ---\n`);
  console.log(`Subject: Your Setcraft Founding DJ pass (#${no})\n`);
  console.log(`Hi ${name},\n\nThanks for backing Setcraft as Founding DJ #${no}! Here's your key:\n\n${key}\n`);
  console.log('To activate it: open Setcraft, click "Founding DJ" in the top bar, choose "I have a key" and paste it in.');
  console.log('It works in any browser you use, forever, including every future update.\n');
} else if (cmd === 'list') {
  const log = readLog();
  if (!log.length) console.log('No keys issued yet.');
  for (const e of log) console.log(`#${e.no}  ${e.iat}  ${e.n}${e.e ? `  <${e.e}>` : ''}`);
} else {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 11).map((l) => l.replace(/^ \*\s?/, '')).join('\n'));
}
