import { useEffect, useRef, useState } from 'react';
import { dragCue, findCueHandle, type CueEdge } from '../core/cues';
import { SLOT_LETTERS, type Cue } from '../core/model';
import { barBeatLabel, beatLength, formatTime } from '../core/time';

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
  const drag = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState<{ cueId: string; edge: CueEdge } | null>(null);
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
        if (s1 <= 0) continue; // before the track starts
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
        const y = p.windowSeconds ? 22 : Math.max(2, h / 2 - 10);
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillRect(x, y, tw, 20);
        ctx.fillStyle = '#fff';
        ctx.fillText(text, x + 6, y + 14);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, width, p.duration, p.peaks, p.peaksPerSecond, p.cues, p.playhead, p.bpm, p.gridStart, p.selectedCueId, p.windowSeconds, p.height]);

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
