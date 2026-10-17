import type { Track } from '../core/model';

/**
 * Demo tracks for trying Setcraft before your own library is ready: three
 * short synthetic club tracks, made right here in the browser (no downloads,
 * nothing copyrighted). Each has real structure (intro, a groove, a breakdown
 * without kick or bass, the drop, an outro) so the waveforms, sections, blends
 * and bass swaps all have something to show.
 */

const SR = 22050;

interface DemoSpec {
  id: string;
  title: string;
  bpm: number;
  key: string;
  /** Bass note, Hz. */
  root: number;
  /** Lead / chord notes, Hz. */
  chord: number[];
  bars: number;
  seed: number;
}

const DEMOS: DemoSpec[] = [
  { id: 'demo-night-drive', title: 'Night Drive', bpm: 124, key: 'Am', root: 55, chord: [220, 261.6, 329.6], bars: 72, seed: 3 },
  { id: 'demo-warehouse', title: 'Warehouse Lights', bpm: 126, key: 'Em', root: 41.2, chord: [164.8, 196, 246.9], bars: 76, seed: 11 },
  { id: 'demo-sunrise', title: 'Sunrise', bpm: 122, key: 'C', root: 65.4, chord: [261.6, 329.6, 392], bars: 68, seed: 23 },
];

const inBars = (bar: number, ranges: [number, number][]) => ranges.some(([a, z]) => bar >= a && bar <= z);

function render(d: DemoSpec): Float32Array {
  const beat = 60 / d.bpm;
  const n = Math.floor(d.bars * 4 * beat * SR);
  const out = new Float32Array(n);
  let s = d.seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  // Sections, in bars: intro 1-8, groove 9-24, breakdown 25-40, drop 41-(end-8), outro.
  const dropEnd = d.bars - 8;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const bar = Math.floor(t / (4 * beat)) + 1;
    const tb = t % beat;
    const t8 = t % (beat / 2);
    const breakdown = inBars(bar, [[25, 40]]);
    let v = 0;
    if (!breakdown) v += Math.sin(2 * Math.PI * 50 * tb * (1 + Math.exp(-tb * 30))) * Math.exp(-tb * 14) * 0.75;
    if (inBars(bar, [[9, 24], [41, dropEnd]])) v += Math.sin(2 * Math.PI * d.root * t) * (t8 > beat * 0.12 && t8 < beat * 0.42 ? 0.38 : 0.04);
    if (bar > 4) v += rnd() * Math.exp(-t8 * 70) * (inBars(bar, [[41, dropEnd]]) ? 0.24 : 0.14);
    if (breakdown || inBars(bar, [[41, dropEnd]])) {
      const swell = breakdown ? Math.min(1, (bar - 24) / 12) : 0.7;
      for (const f of d.chord) v += Math.sin(2 * Math.PI * f * t) * 0.07 * swell;
    }
    out[i] = Math.max(-1, Math.min(1, v * 0.8));
  }
  return out;
}

function wav(samples: Float32Array): ArrayBuffer {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, x: string) => [...x].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, SR, true);
  v.setUint32(28, SR * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(samples[i] * 32767), true);
  return buf;
}

export const DEMO_ARTIST = 'Setcraft Demo';

/** The demo tracks and their audio files. Yields between tracks so the page stays responsive. */
export async function makeDemoTracks(): Promise<{ track: Track; file: File }[]> {
  const out: { track: Track; file: File }[] = [];
  for (const d of DEMOS) {
    await new Promise((r) => setTimeout(r, 0));
    const samples = render(d);
    const file = new File([wav(samples)], `${DEMO_ARTIST} - ${d.title}.wav`, { type: 'audio/wav' });
    out.push({
      file,
      track: {
        id: d.id,
        title: d.title,
        artist: DEMO_ARTIST,
        genre: 'Demo',
        key: d.key,
        bpm: d.bpm,
        gridStart: 0,
        duration: samples.length / SR,
        cues: [],
        source: 'manual',
        comment: 'Made by Setcraft for trying things out',
      },
    });
  }
  return out;
}

export const isDemoTrack = (t: Track) => t.id.startsWith('demo-');
