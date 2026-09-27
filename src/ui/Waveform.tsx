import { useEffect, useMemo, useRef, useState } from 'react';
import { maxPeak, sampleAt } from '../core/analysis';
import { dragCue, findCueHandle, type CueEdge } from '../core/cues';
import { SLOT_LETTERS, type Cue } from '../core/model';
import { barBeatLabel, beatLength, formatTime } from '../core/time';
import type { WaveformBands } from '../core/waveform';
import { SECTION_LABELS, type Section, type SectionKind } from '../core/sections';

interface Props {
  duration: number;
  peaks?: Float32Array;
  /** Detected song parts, shaded and labelled. */
  sections?: Section[];
  /** Bass / mid / high split for coloured drawing (single colour without it). */
  bands?: WaveformBands;
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
  /** Enables dragging cues: called with the new position while dragging. */
  onCueDrag?: (id: string, change: Pick<Cue, 'start' | 'end'>) => void;
  /** Beat-grid snapping for drags (Shift bypasses it). */
  snap?: (sec: number) => number;
}

/** Pixels the pointer must move before a press on a cue becomes a drag. */
const DRAG_THRESHOLD = 3;

interface DragState {
  cueId: string;
  edge: CueEdge;
  original: Cue;
  startX: number;
  active: boolean;
}

const BAND_COLORS = { low: '#2f6bff', mid: '#f59b23', high: '#f2efe8' };

export const SECTION_COLORS: Record<SectionKind, string> = {
  intro: '#7c8db5',
  breakdown: '#a78bfa',
  build: '#fbbf24',
  drop: '#f43f5e',
  main: '#34d399',
  outro: '#7c8db5',
};

const COLORS = {
  bg: '#12141a',
  wave: '#3d6fd6',
  grid: 'rgba(255,255,255,0.07)',
  bar: 'rgba(255,255,255,0.22)',
  phrase: 'rgba(255,255,255,0.45)',
  playhead: '#ffffff',
};

export function Waveform(p: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState<{ cueId: string; edge: CueEdge } | null>(null);
  const [width, setWidth] = useState(0);
  const peakMax = useMemo(() => (p.peaks ? maxPeak(p.peaks) : 1), [p.peaks]);

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

    // Song sections: tinted backgrounds so intro / breakdown / drop read at a glance.
    for (const sec of p.sections ?? []) {
      const x0 = Math.max(0, xOf(sec.start));
      const x1 = Math.min(w, xOf(sec.end));
      if (x1 <= x0) continue;
      ctx.fillStyle = hexA(SECTION_COLORS[sec.kind], p.windowSeconds ? 0.13 : 0.2);
      ctx.fillRect(x0, 0, x1 - x0, h);
    }

    // Phrase lines every 16 bars on the overview
    if (p.bpm && !p.windowSeconds) {
      const phrase = beatLength(p.bpm) * 64;
      const g0 = p.gridStart ?? 0;
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      for (let t = g0 - Math.floor(g0 / phrase) * phrase; t < to; t += phrase) {
        if (t > 0) ctx.fillRect(Math.round(xOf(t)), 0, 1, h);
      }
    }

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
          const isPhrase = ((b % 64) + 64) % 64 === 0; // every 16 bars
          ctx.fillStyle = isPhrase ? COLORS.phrase : isBar ? COLORS.bar : COLORS.grid;
          ctx.fillRect(Math.round(sx) - (isPhrase ? 1 : 0), 0, isPhrase ? 2 : 1, h);
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

    // Waveform: rekordbox-style three bands (bass blue, mids amber, highs white),
    // normalised so quiet masters fill the view. Played audio is dimmed.
    if (p.peaks && p.peaksPerSecond) {
      const pps = p.peaksPerSecond;
      const peaks = p.peaks;
      const gain = 1 / Math.max(peakMax, 0.05);
      const height = mid - 3;
      // Close to linear, so quiet breakdowns stay visibly lower than drops.
      const scale = (v: number) => Math.pow(Math.min(1, v * gain), 0.95) * height;
      const bucketsPerPx = (span / w) * pps;
      // Zoomed out: loudest bucket under the pixel. Zoomed in past the analysis
      // resolution: blend neighbours so the shape stays smooth.
      const valueAt = (arr: Float32Array, s0: number, s1: number) => {
        if (bucketsPerPx < 1) return sampleAt(arr, ((s0 + s1) / 2) * pps - 0.5);
        const i0 = Math.max(0, Math.floor(s0 * pps));
        const i1 = Math.min(arr.length, Math.max(i0 + 1, Math.ceil(s1 * pps)));
        let m = 0;
        for (let i = i0; i < i1; i++) if (arr[i] > m) m = arr[i];
        return m;
      };
      const layers: [Float32Array, string, number][] = p.bands
        ? [
            // Highs are drawn on top and slightly smaller so bass stays readable.
            [p.bands.low, BAND_COLORS.low, 1],
            [p.bands.mid, BAND_COLORS.mid, 0.95],
            [p.bands.high, BAND_COLORS.high, 0.75],
          ]
        : [[peaks, COLORS.wave, 1]];
      const lastSec = peaks.length / pps;
      for (let px = 0; px < w; px++) {
        const s0 = from + (px / w) * span;
        const s1 = from + ((px + 1) / w) * span;
        if (s1 <= 0 || s0 >= lastSec) continue; // outside the track
        ctx.globalAlpha = s1 <= p.playhead ? 0.5 : 1;
        for (const [arr, color, boost] of layers) {
          const amp = scale(valueAt(arr, Math.max(0, s0), s1) * boost);
          if (amp < 0.5) continue;
          ctx.fillStyle = color;
          ctx.fillRect(px, mid - amp, 1, amp * 2);
        }
      }
      ctx.globalAlpha = 1;
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

    // Section boundaries and names
    ctx.font = 'bold 10px system-ui';
    const secs = p.sections ?? [];
    secs.forEach((sec, i) => {
      const color = SECTION_COLORS[sec.kind];
      const x0 = xOf(sec.start);
      const x1 = xOf(sec.end);
      if (x1 < 0 || x0 > w) return;
      if (i > 0 && x0 >= 0) {
        ctx.fillStyle = hexA(color, 0.9);
        ctx.fillRect(Math.round(x0), 0, 2, h);
      }
      const label = SECTION_LABELS[sec.kind].toUpperCase();
      // Pin the name to the left edge while its section is on screen.
      const lx = Math.max(x0, 0) + 5;
      const tw = ctx.measureText(label).width;
      if (Math.min(x1, w) - lx < tw + 4) return;
      const ly = p.windowSeconds ? 19 : 3;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(lx - 3, ly, tw + 6, 13);
      ctx.fillStyle = color;
      ctx.fillText(label, lx, ly + 10);
    });

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

    // Loop end handles (drag to resize)
    for (const cue of p.cues) {
      if (cue.kind !== 'loop' || cue.end === undefined) continue;
      const ex = xOf(cue.end);
      if (ex < -10 || ex > w + 10) continue;
      ctx.fillStyle = cue.color;
      ctx.fillRect(Math.round(ex) - 1, 0, 2, h);
      ctx.fillRect(Math.round(ex) - 5, h - 12, 5, 12);
    }

    // Playhead
    ctx.fillStyle = COLORS.playhead;
    ctx.fillRect(Math.round(xOf(p.playhead)), 0, 1.5, h);

    // Live position readout while dragging
    if (dragging) {
      const cue = p.cues.find((c) => c.id === dragging.cueId);
      const sec = cue && (dragging.edge === 'end' ? cue.end : cue.start);
      if (cue && sec !== undefined) {
        const bb = barBeatLabel(sec, p.bpm, p.gridStart);
        const text =
          dragging.edge === 'end' && cue.end !== undefined
            ? `end ${formatTime(sec)}${p.bpm ? ` · ${Math.round(((cue.end - cue.start) / beatLength(p.bpm)) * 100) / 100} beats` : ''}`
            : `${formatTime(sec)}${bb ? ` · bar ${bb}` : ''}`;
        ctx.font = 'bold 12px system-ui';
        const tw = ctx.measureText(text).width + 12;
        const x = Math.min(Math.max(0, xOf(sec) + 6), w - tw);
        const y = p.windowSeconds ? 38 : Math.max(2, h / 2 - 10);
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillRect(x, y, tw, 20);
        ctx.fillStyle = '#fff';
        ctx.fillText(text, x + 6, y + 14);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, width, peakMax, p.sections, p.bands, p.duration, p.peaks, p.peaksPerSecond, p.cues, p.playhead, p.bpm, p.gridStart, p.selectedCueId, p.windowSeconds, p.height]);

  const secAt = (clientX: number) => {
    const rect = canvas.current!.getBoundingClientRect();
    const { from, to } = view();
    return from + ((clientX - rect.left) / rect.width) * (to - from);
  };

  const handleAt = (clientX: number) => {
    const rect = canvas.current!.getBoundingClientRect();
    const { from, to } = view();
    return findCueHandle(p.cues, secAt(clientX), rect.width / (to - from));
  };

  const endDrag = () => {
    drag.current = null;
    setDragging(null);
  };

  // Esc cancels a drag and puts the cue back.
  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !drag.current) return;
      const { original } = drag.current;
      p.onCueDrag?.(original.id, { start: original.start, end: original.end });
      endDrag();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  return (
    <canvas
      ref={canvas}
      className={`${p.windowSeconds ? 'wave detail' : 'wave overview'}${dragging ? ' dragging' : ''}`}
      style={{ height: p.height }}
      onPointerDown={(e) => {
        const hit = handleAt(e.clientX);
        if (hit) {
          p.onSelectCue?.(hit.cue.id);
          if (p.onCueDrag) {
            drag.current = { cueId: hit.cue.id, edge: hit.edge, original: hit.cue, startX: e.clientX, active: false };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }
          return;
        }
        p.onSeek(Math.max(0, Math.min(p.duration, secAt(e.clientX))));
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) {
          // Hover feedback: hand over cues, resize arrows over loop ends.
          if (p.onCueDrag) {
            const hit = handleAt(e.clientX);
            e.currentTarget.style.cursor = hit ? (hit.edge === 'end' ? 'ew-resize' : 'grab') : '';
          }
          return;
        }
        if (!d.active) {
          if (Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD) return;
          d.active = true;
          setDragging({ cueId: d.cueId, edge: d.edge });
        }
        const snap = e.shiftKey ? undefined : p.snap;
        p.onCueDrag?.(d.cueId, dragCue(d.original, d.edge, secAt(e.clientX), p.duration, snap));
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    />
  );
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
