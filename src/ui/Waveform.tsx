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
  /** Click to jump (the parent applies beat / bar snapping). */
  onSeek: (sec: number) => void;
  /** Free movement while scrubbing (drag or wheel); falls back to onSeek. */
  onScrub?: (sec: number) => void;
  /** A scrub (drag or wheel) or a cue drag begins / ends: the deck holds playback in between. */
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  /** ⌘/Ctrl + wheel: 1 = zoom in, -1 = zoom out. */
  onZoom?: (dir: 1 | -1) => void;
  /** While playing, the waveform follows this at display rate instead of `playhead`. */
  livePlayhead?: () => number;
  playing?: boolean;
  onSelectCue?: (id: string) => void;
  /** Enables dragging cues: called with the new position while dragging. */
  onCueDrag?: (id: string, change: Pick<Cue, 'start' | 'end'>) => void;
  /** Beat-grid snapping for drags (Shift bypasses it). */
  snap?: (sec: number) => number;
}

/** Pixels the pointer must move before a press on a cue becomes a drag. */
const DRAG_THRESHOLD = 3;

/** How long after the last wheel event a wheel scrub counts as finished. */
const WHEEL_IDLE_MS = 160;

/**
 * Waveform amplitudes per pixel column, cached for the current zoom. Columns
 * sit at fixed points in the track (column k covers k·dt … (k+1)·dt), so as the
 * view scrolls the shape just slides instead of being re-sampled differently
 * every frame, which is what made peaks flicker.
 */
interface ColumnCache {
  sources: Float32Array[];
  dt: number;
  gain: number;
  height: number;
  cols: Float32Array[]; // -1 = not computed yet
}

interface DragState {
  cueId: string;
  edge: CueEdge;
  original: Cue;
  startX: number;
  active: boolean;
  /** Where on the cue it was grabbed (seconds from the dragged edge), so it doesn't jump to the pointer. */
  grabOffset: number;
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
  bg: '#07070a',
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
  /** The playhead the canvas last drew; pointer maths uses it so it matches what you see. */
  const shownPlayhead = useRef(p.playhead);
  const scrub = useRef<{ startX: number; startPlay: number; moved: boolean } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const props = useRef(p);
  props.current = p;
  const columns = useRef<ColumnCache | null>(null);
  /** Cue handle under the pointer, highlighted so it's clear what a press will grab. */
  const hover = useRef<{ cueId: string; edge: CueEdge } | null>(null);
  /** While a cue is pressed, the view stays where it was so the cue stays under the pointer. */
  const frozenView = useRef<number | null>(null);
  /** Cue moves are passed on at most once per frame; fast mice send several per frame. */
  const pendingMove = useRef<{ id: string; change: Pick<Cue, 'start' | 'end'>; raf: number } | null>(null);
  const flushMove = () => {
    const m = pendingMove.current;
    if (!m) return;
    cancelAnimationFrame(m.raf);
    pendingMove.current = null;
    props.current.onCueDrag?.(m.id, m.change);
  };
  const wheelTimer = useRef(0);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ro = new ResizeObserver(() => setWidth(c.clientWidth));
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  const view = (playhead = frozenView.current ?? shownPlayhead.current) => {
    if (!p.windowSeconds) return { from: 0, to: Math.max(p.duration, 1) };
    const half = p.windowSeconds / 2;
    return { from: playhead - half, to: playhead + half };
  };

  const draw = (playhead: number) => {
    shownPlayhead.current = playhead;
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

    const { from, to } = view(frozenView.current ?? playhead);
    const span = to - from;
    const xOf = (s: number) => ((s - from) / span) * w;
    // Line positions rounded to device pixels, so thin lines move smoothly with the waveform.
    const px = (x: number) => Math.round(x * dpr) / dpr;
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
        if (t > 0) ctx.fillRect(px(xOf(t)), 0, 1, h);
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
          ctx.fillRect(px(sx) - (isPhrase ? 1 : 0), 0, isPhrase ? 2 : 1, h);
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
      const dt = span / w;
      const bucketsPerPx = dt * pps;
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
      const n = Math.ceil(lastSec / dt);
      let cache = columns.current;
      if (
        !cache ||
        cache.dt !== dt ||
        cache.gain !== gain ||
        cache.height !== height ||
        cache.sources.length !== layers.length ||
        cache.sources.some((a, i) => a !== layers[i][0])
      ) {
        cache = { sources: layers.map((l) => l[0]), dt, gain, height, cols: layers.map(() => new Float32Array(n).fill(-1)) };
        columns.current = cache;
      }
      const k0 = Math.max(0, Math.floor(from / dt) - 1);
      const k1 = Math.min(n - 1, Math.ceil(to / dt) + 1);
      const playX = Math.max(0, Math.min(w, xOf(playhead)));
      layers.forEach(([arr, color, boost], li) => {
        const cols = cache.cols[li];
        const amp = (k: number) => {
          if (k < 0 || k >= n) return 0;
          let v = cols[k];
          if (v < 0) v = cols[k] = scale(valueAt(arr, k * dt, (k + 1) * dt) * boost);
          return v;
        };
        if (k1 < k0) return;
        // Lightly smoothed so the outline flows; peaks keep most of their height.
        const path = new Path2D();
        const top: number[] = [];
        for (let k = k0; k <= k1; k++) {
          const a = amp(k);
          top.push(Math.max(a * 0.7, amp(k - 1) * 0.25 + a * 0.5 + amp(k + 1) * 0.25));
        }
        const xk = (k: number) => xOf((k + 0.5) * dt);
        path.moveTo(xOf(k0 * dt), mid);
        for (let k = k0; k <= k1; k++) path.lineTo(xk(k), mid - top[k - k0]);
        path.lineTo(xOf(Math.min(lastSec, (k1 + 1) * dt)), mid);
        for (let k = k1; k >= k0; k--) path.lineTo(xk(k), mid + top[k - k0]);
        path.closePath();
        ctx.fillStyle = color;
        // Already-played audio is dimmed.
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, playX, h);
        ctx.clip();
        ctx.globalAlpha = 0.42;
        ctx.fill(path);
        ctx.restore();
        ctx.save();
        ctx.beginPath();
        ctx.rect(playX, 0, w - playX, h);
        ctx.clip();
        ctx.fill(path);
        ctx.restore();
      });
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
        ctx.fillRect(px(x0), 0, 2, h);
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
      const hovered = hover.current?.cueId === cue.id && hover.current.edge === 'start';
      const selected = cue.id === p.selectedCueId || hovered || dragging?.cueId === cue.id;
      ctx.fillStyle = cue.color;
      ctx.fillRect(px(cx) - (selected ? 1 : 0), 0, selected ? 3 : 2, h);
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
      ctx.fillRect(px(ex) - 1, 0, 2, h);
      ctx.fillRect(px(ex) - 5, h - 12, 5, 12);
    }

    // Playhead
    ctx.fillStyle = COLORS.playhead;
    ctx.fillRect(px(xOf(playhead)) - 0.5, 0, 1.5, h);
    if (p.windowSeconds) {
      // soft glow either side of the playhead
      const gx = xOf(playhead);
      const glow = ctx.createLinearGradient(gx - 14, 0, gx + 14, 0);
      glow.addColorStop(0, 'rgba(255,255,255,0)');
      glow.addColorStop(0.5, 'rgba(255,255,255,0.10)');
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(gx - 14, 0, 28, h);
    }

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
  };
  const drawRef = useRef(draw);
  drawRef.current = draw;

  // Redraw on any change; while playing, follow the live position every frame
  // without waiting for React (smooth 60 fps scrolling).
  useEffect(() => {
    if (!(p.playing && p.livePlayhead)) {
      drawRef.current(p.playhead);
      return;
    }
    let raf = 0;
    const tick = () => {
      const live = props.current.livePlayhead;
      drawRef.current(live ? live() : props.current.playhead);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.playing, dragging, width, peakMax, p.sections, p.bands, p.duration, p.peaks, p.peaksPerSecond, p.cues, p.playhead, p.bpm, p.gridStart, p.selectedCueId, p.windowSeconds, p.height]);

  // Wheel / trackpad scrolls through the track; ⌘/Ctrl + wheel zooms.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      const q = props.current;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        q.onZoom?.(e.deltaY < 0 ? 1 : -1);
        return;
      }
      const { from, to } = view();
      const secPerPx = (to - from) / c.clientWidth;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!wheelTimer.current) q.onScrubStart?.();
      window.clearTimeout(wheelTimer.current);
      wheelTimer.current = window.setTimeout(() => {
        wheelTimer.current = 0;
        props.current.onScrubEnd?.();
      }, WHEEL_IDLE_MS);
      (q.onScrub ?? q.onSeek)(Math.max(0, Math.min(q.duration, shownPlayhead.current + delta * secPerPx)));
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      c.removeEventListener('wheel', onWheel);
      if (wheelTimer.current) {
        window.clearTimeout(wheelTimer.current);
        wheelTimer.current = 0;
        props.current.onScrubEnd?.();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.windowSeconds, p.duration]);

  const secAt = (clientX: number) => {
    const rect = canvas.current!.getBoundingClientRect();
    const { from, to } = view();
    return from + ((clientX - rect.left) / rect.width) * (to - from);
  };

  const handleAt = (clientX: number, clientY: number) => {
    const rect = canvas.current!.getBoundingClientRect();
    const { from, to } = view();
    // The letter flag at the top of each marker can be grabbed as well as the line.
    const flag = p.windowSeconds ? 16 : 12;
    const onFlagRow = clientY - rect.top <= flag + 3;
    return findCueHandle(p.cues, secAt(clientX), rect.width / (to - from), 7, onFlagRow ? flag : 0);
  };

  const setHover = (h: { cueId: string; edge: CueEdge } | null) => {
    const cur = hover.current;
    if (cur?.cueId === h?.cueId && cur?.edge === h?.edge) return;
    hover.current = h;
    drawRef.current(shownPlayhead.current);
  };

  const endDrag = () => {
    flushMove();
    if (drag.current?.active) p.onScrubEnd?.();
    drag.current = null;
    setDragging(null);
    if (frozenView.current !== null) {
      frozenView.current = null;
      drawRef.current(shownPlayhead.current);
    }
  };

  // Esc cancels a drag and puts the cue back.
  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !drag.current) return;
      const { original } = drag.current;
      pendingMove.current = null;
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
      className={`${p.windowSeconds ? 'wave detail' : 'wave overview'}${dragging || scrubbing ? ' dragging' : ''}`}
      style={{ height: p.height }}
      onPointerDown={(e) => {
        const hit = handleAt(e.clientX, e.clientY);
        if (hit) {
          p.onSelectCue?.(hit.cue.id);
          if (p.onCueDrag) {
            if (p.windowSeconds) frozenView.current = shownPlayhead.current;
            const at = hit.edge === 'end' && hit.cue.end !== undefined ? hit.cue.end : hit.cue.start;
            drag.current = {
              cueId: hit.cue.id,
              edge: hit.edge,
              original: hit.cue,
              startX: e.clientX,
              active: false,
              grabOffset: secAt(e.clientX) - at,
            };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }
          return;
        }
        // Empty area: grab to scrub (zoomed view) or drag along (overview); a plain click jumps.
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        scrub.current = { startX: e.clientX, startPlay: shownPlayhead.current, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        const sc = scrub.current;
        if (sc) {
          const dx = e.clientX - sc.startX;
          if (!sc.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
          if (!sc.moved) {
            sc.moved = true;
            setScrubbing(true);
            p.onScrubStart?.();
          }
          const scrubTo = p.onScrub ?? p.onSeek;
          if (p.windowSeconds) {
            // Pull the waveform like a record: drag left to move forward.
            const secPerPx = p.windowSeconds / e.currentTarget.clientWidth;
            scrubTo(Math.max(0, Math.min(p.duration, sc.startPlay - dx * secPerPx)));
          } else {
            scrubTo(Math.max(0, Math.min(p.duration, secAt(e.clientX))));
          }
          return;
        }
        if (!d) {
          // Hover feedback: the cue under the pointer lights up, with a sideways-move
          // cursor (resize over loop ends); empty space shows the grab hand for scrubbing.
          if (p.onCueDrag) {
            const hit = handleAt(e.clientX, e.clientY);
            e.currentTarget.style.cursor = hit ? (hit.edge === 'end' ? 'col-resize' : 'ew-resize') : '';
            setHover(hit ? { cueId: hit.cue.id, edge: hit.edge } : null);
          }
          return;
        }
        if (!d.active) {
          if (Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD) return;
          d.active = true;
          setDragging({ cueId: d.cueId, edge: d.edge });
          // Hold playback while a cue is moved, so the waveform stays still under the pointer.
          p.onScrubStart?.();
        }
        const snap = e.shiftKey ? undefined : p.snap;
        const change = dragCue(d.original, d.edge, secAt(e.clientX) - d.grabOffset, p.duration, snap);
        if (pendingMove.current) pendingMove.current.change = change;
        else pendingMove.current = { id: d.cueId, change, raf: requestAnimationFrame(flushMove) };
      }}
      onPointerUp={(e) => {
        const sc = scrub.current;
        if (sc && !sc.moved) p.onSeek(Math.max(0, Math.min(p.duration, secAt(e.clientX))));
        if (sc?.moved) p.onScrubEnd?.();
        scrub.current = null;
        setScrubbing(false);
        endDrag();
      }}
      onPointerLeave={() => {
        if (!drag.current) setHover(null);
      }}
      onPointerCancel={() => {
        if (scrub.current?.moved) p.onScrubEnd?.();
        scrub.current = null;
        setScrubbing(false);
        endDrag();
      }}
    />
  );
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
