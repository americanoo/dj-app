// Synthetic test tracks for the browser tests, written as WAV files so no real
// music has to live in the repo. Deterministic: the same bytes every run.
//
//   Delta - Warehouse.wav  130 BPM, 160 s: intro, main, breakdown, drop, outro
//   Steady - Groove.wav    120 BPM, 96 bars: bass throughout, parts by phrase
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SR = 22050;

function wav(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return buf;
}

function noise(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
}

const inBars = (bar, ranges) => ranges.some(([a, z]) => bar >= a && bar <= z);

/** Techno at 130: kick + hats intro, bass joins, a long breakdown without kick or bass, the drop, a kick outro. */
function warehouse() {
  const bpm = 130;
  const beat = 60 / bpm;
  const n = Math.floor(160 * SR);
  const out = new Float32Array(n);
  const rnd = noise(7);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const bar = Math.floor(t / (4 * beat)) + 1;
    const tb = t % beat;
    const t8 = t % (beat / 2);
    let v = 0;
    const kick = !inBars(bar, [[33, 56]]);
    const bass = inBars(bar, [[17, 32], [57, 80]]);
    if (kick) v += Math.sin(2 * Math.PI * 52 * tb) * Math.exp(-tb * 16) * 0.8;
    if (bass) v += Math.sin(2 * Math.PI * 65 * t) * (t8 < beat * 0.3 ? 0.4 : 0.05);
    if (!inBars(bar, [[1, 8]])) v += rnd() * Math.exp(-t8 * 70) * 0.2;
    if (inBars(bar, [[33, 56]])) v += (Math.sin(2 * Math.PI * 330 * t) + Math.sin(2 * Math.PI * 415 * t)) * 0.1 * Math.min(1, (bar - 32) / 8);
    if (inBars(bar, [[57, 80]])) v += Math.sin(2 * Math.PI * 880 * t) * 0.06;
    out[i] = v * 0.8;
  }
  return out;
}

/** 120 BPM, 96 bars: the bass never stops; hats, a "vocal" and chords come and go by phrase. */
function groove() {
  const bpm = 120;
  const beat = 60 / bpm;
  const n = Math.floor(96 * 4 * beat * SR);
  const out = new Float32Array(n);
  const rnd = noise(1);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const bar = Math.floor(t / (4 * beat)) + 1;
    const tb = t % beat;
    const t8 = t % (beat / 2);
    let v = 0;
    v += Math.sin(2 * Math.PI * 55 * tb) * Math.exp(-tb * 18) * 0.7;
    v += Math.sin(2 * Math.PI * 82 * t) * (t8 < beat * 0.35 ? 0.35 : 0.05);
    if (inBars(bar, [[17, 48], [65, 96]])) v += rnd() * Math.exp(-t8 * 60) * 0.25;
    if (inBars(bar, [[33, 48], [81, 96]])) v += (Math.sin(2 * Math.PI * 660 * t) + Math.sin(2 * Math.PI * 990 * t)) * 0.12;
    if (inBars(bar, [[49, 64]])) v += (Math.sin(2 * Math.PI * 392 * t) + Math.sin(2 * Math.PI * 494 * t) + Math.sin(2 * Math.PI * 587 * t)) * 0.08;
    out[i] = v * 0.8;
  }
  return out;
}

/** Writes the music folder under `root` (skipping files already there). */
export function makeMusic(root) {
  const files = {
    [join(root, 'Techno', 'Delta - Warehouse.wav')]: warehouse,
    [join(root, 'Latin', 'Steady - Groove.wav')]: groove,
  };
  for (const [file, make] of Object.entries(files)) {
    if (existsSync(file)) continue;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, wav(make()));
  }
}

