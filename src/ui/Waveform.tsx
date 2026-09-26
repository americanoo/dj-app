import { useEffect, useRef, useState } from 'react';
import { SLOT_LETTERS, type Cue } from '../core/model';
import { beatLength } from '../core/time';

interface Props {
  duration: number;
  peaks?: Float32Array;
  peaksPerSecond?: number;
  cues: Cue[];
  playhead: number;
  bpm?: number;
  gridStart?: number;
  selectedCueId: string | null;
  /** Detail view: visible window in seconds, centred on the playhead. Omit for overview. */
  windowSeconds?: number;
  height: number;
  onSeek: (sec: number) => void;
  onSelectCue?: (id: string) => void;
  onMoveCue?: (id: string, sec: number) => void;
}

const COLORS = {
  bg: '#12141a',
  wave: '#3d6fd6',
  wavePlayed: '#7aa2ff',
  grid: 'rgba(255,255,255,0.07)',
  bar: 'rgba(255,255,255,0.22)',
  playhead: '#ffffff',
};

export function Waveform(p: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ cueId: string; moved: boolean } | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ro = new ResizeObserver(() => setWidth(c.clientWidth));
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  const view = () => {
    if (!p.windowSeconds) return { from: 0, to: Math.max(p.duration, 1) };
    const half = p.windowSeconds / 2;
    return { from: p.playhead - half, to: p.playhead + half };
  };

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = p.height;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    const { from, to } = view();
    const span = to - from;
    const xOf = (s: number) => ((s - from) / span) * w;
    const mid = h / 2;

    // Beat grid (detail view only, when zoomed enough to be readable)
    if (p.bpm && p.windowSeconds) {
      const beat = beatLength(p.bpm);
      const g0 = p.gridStart ?? 0;
      const first = Math.ceil((from - g0) / beat);
      const last = Math.floor((to - g0) / beat);
      if (last - first < w / 4) {
        for (let b = first; b <= last; b++) {
          const sx = xOf(g0 + b * beat);
          const isBar = ((b % 4) + 4) % 4 === 0;
          ctx.fillStyle = isBar ? COLORS.bar : COLORS.grid;
          ctx.fillRect(Math.round(sx), 0, 1, h);
          if (isBar && (b / 4) % 4 === 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.font = '10px system-ui';
            ctx.fillText(String(b / 4 + 1), sx + 3, h - 4);
          }
        }
      }
    }

    // Loop regions
    for (const cue of p.cues) {
      if (cue.kind !== 'loop' || cue.end === undefined) continue;
      ctx.fillStyle = hexA(cue.color, cue.id === p.selectedCueId ? 0.35 : 0.2);
      ctx.fillRect(xOf(cue.start), 0, Math.max(1, xOf(cue.end) - xOf(cue.start)), h);
    }

    // Waveform
    if (p.peaks && p.peaksPerSecond) {
      const pps = p.peaksPerSecond;
      for (let px = 0; px < w; px++) {
        const s0 = from + (px / w) * span;
        const s1 = from + ((px + 1) / w) * span;
        const i0 = Math.max(0, Math.floor(s0 * pps));
        const i1 = Math.min(p.peaks.length, Math.max(i0 + 1, Math.ceil(s1 * pps)));
        if (i0 >= p.peaks.length || i1 <= 0) continue;
        let max = 0;
        for (let i = i0; i < i1; i++) if (p.peaks[i] > max) max = p.peaks[i];
        const amp = Math.sqrt(max) * (mid - 4);
        ctx.fillStyle = s0 < p.playhead ? COLORS.wavePlayed : COLORS.wave;
        ctx.fillRect(px, mid - amp, 1, amp * 2);
      }
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(Math.max(0, xOf(0)), mid - 1, Math.min(w, xOf(p.duration)) - Math.max(0, xOf(0)), 2);
      if (!p.windowSeconds) {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '12px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('Attach the audio file to see the waveform and preview', w / 2, mid - 10);
        ctx.textAlign = 'start';
      }
    }

    // Track bounds
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    if (xOf(0) > 0) ctx.fillRect(0, 0, xOf(0), h);
    if (xOf(p.duration) < w) ctx.fillRect(xOf(p.duration), 0, w - xOf(p.duration), h);

    // Cue markers
    for (const cue of p.cues) {
      const cx = xOf(cue.start);
      if (cx < -20 || cx > w + 20) continue;
      const selected = cue.id === p.selectedCueId;
      ctx.fillStyle = cue.color;
      ctx.fillRect(Math.round(cx) - (selected ? 1 : 0), 0, selected ? 3 : 2, h);
      const label = cue.slot !== null ? SLOT_LETTERS[cue.slot] : cue.kind === 'loop' ? '↻' : '▾';
      const tw = p.windowSeconds ? 16 : 12;
      ctx.fillRect(cx, 0, tw, tw);
      ctx.fillStyle = '#000';
      ctx.font = `bold ${p.windowSeconds ? 11 : 9}px system-ui`;
      ctx.fillText(label, cx + 3, tw - 3);
      if (p.windowSeconds && cue.name) {
        ctx.fillStyle = cue.color;
        ctx.font = '11px system-ui';
        ctx.fillText(cue.name, cx + tw + 4, 12);
      }
    }

    // Playhead
    ctx.fillStyle = COLORS.playhead;
    ctx.fillRect(Math.round(xOf(p.playhead)), 0, 1.5, h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, p.duration, p.peaks, p.peaksPerSecond, p.cues, p.playhead, p.bpm, p.gridStart, p.selectedCueId, p.windowSeconds, p.height]);

  const secAt = (clientX: number) => {
    const rect = canvas.current!.getBoundingClientRect();
    const { from, to } = view();
    return from + ((clientX - rect.left) / rect.width) * (to - from);
  };

  const cueNear = (clientX: number): Cue | undefined => {
    const rect = canvas.current!.getBoundingClientRect();
    const { from, to } = view();
    const pxPerSec = rect.width / (to - from);
    const s = secAt(clientX);
    return p.cues
      .map((c) => ({ c, d: Math.abs(c.start - s) * pxPerSec }))
      .filter((x) => x.d < 7)
      .sort((a, b) => a.d - b.d)[0]?.c;
  };

  return (
    <canvas
      ref={canvas}
      className={p.windowSeconds ? 'wave detail' : 'wave overview'}
      style={{ height: p.height }}
      onPointerDown={(e) => {
        const hit = cueNear(e.clientX);
        if (hit) {
          p.onSelectCue?.(hit.id);
          if (p.onMoveCue && p.windowSeconds) {
            drag.current = { cueId: hit.id, moved: false };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }
          return;
        }
        p.onSeek(Math.max(0, Math.min(p.duration, secAt(e.clientX))));
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        drag.current.moved = true;
        p.onMoveCue?.(drag.current.cueId, Math.max(0, secAt(e.clientX)));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
    />
  );
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
