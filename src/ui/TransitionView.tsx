import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { keyColor, keyRelation, toCamelot, type KeyRelation } from '../core/keys';
import type { Track } from '../core/model';
import type { Section } from '../core/sections';
import { buildTimeline, describeTransition, nightSlots, transitionsOf, type NightSlot } from '../core/setplan';
import { formatTime } from '../core/time';
import type { WaveformData } from '../core/waveform';
import { useFitZoom, zoomOf } from './fit';
import { useNight, useNightState } from './night';
import { activeSet, useStore } from './store';
import { useTrackWave } from './trackWave';
import { transport } from './transport';
import { SECTION_COLORS } from './Waveform';

/**
 * Two decks on one clock: the outgoing track on the left, the incoming one on
 * the right, and both waveforms lined up in between exactly as the night plays
 * them. The overlap is highlighted; drag the incoming track to move where it
 * comes in (it snaps to the outgoing track's beats), and preview it.
 */

const CONTEXT_BARS = [8, 16, 32, 64] as const;
const COLORS = { low: '#2f6bff', mid: '#f59b23', high: '#f2efe8' };
const IN_COLOR = '#22d3ee';
const OUT_COLOR = '#f472b6';

const RELATION_TEXT: Record<KeyRelation, string> = {
  same: 'same key',
  adjacent: 'adjacent ✓',
  relative: 'relative ✓',
  diagonal: 'diagonal ✓',
  boost: 'energy boost',
  clash: 'key clash',
  unknown: 'key unknown',
};

interface Props {
  selectedTrackId: string | null;
  onSelectTrack: (trackId: string) => void;
}

export function TransitionView({ selectedTrackId, onSelectTrack }: Props) {
  const { project, dispatch } = useStore();
  const set = activeSet(project);
  const slots = useMemo(() => nightSlots(buildTimeline(set, project.library)), [set, project.library]);
  const pairs = useMemo(() => transitionsOf(slots), [slots]);
  const night = useNight();
  const nightState = useNightState();
  const [index, setIndex] = useState(0);
  const [context, setContext] = useState<(typeof CONTEXT_BARS)[number]>(16);
  // Always fully visible: on a short panel the canvas gives way first, then everything scales down.
  const fitRef = useFitZoom<HTMLDivElement>(0.5);

  // Show the transition of the track opened in the deck.
  useEffect(() => {
    if (!selectedTrackId) return;
    const i = pairs.findIndex((p) => p.a.trackId === selectedTrackId);
    const j = pairs.findIndex((p) => p.b.trackId === selectedTrackId);
    if (i >= 0) setIndex(i);
    else if (j >= 0) setIndex(j);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTrackId]);

  // While the night plays, follow it: the coming (or current) transition is on show.
  const pairsRef = useRef(pairs);
  pairsRef.current = pairs;
  useEffect(() => {
    if (!nightState.playing) return;
    const follow = () => {
      const t = night.position();
      const i = pairsRef.current.findIndex((p) => Math.max(p.b.startsAt, p.a.startsAt + p.a.playFor) + 4 > t);
      if (i >= 0) setIndex(i);
    };
    follow();
    const id = window.setInterval(follow, 250);
    return () => window.clearInterval(id);
  }, [nightState.playing, night]);

  const i = Math.min(index, Math.max(0, pairs.length - 1));
  const pair = pairs[i];
  const a = pair?.a;
  const b = pair?.b;
  const ta = a ? project.library.tracks[a.trackId] : undefined;
  const tb = b ? project.library.tracks[b.trackId] : undefined;
  const waveA = useTrackWave(a?.trackId);
  const waveB = useTrackWave(b?.trackId);
  const info = a && b ? describeTransition(a, b) : undefined;

  // The window: the join, with `context` bars of the outgoing track either side.
  const beatA = a?.bpm ? 60 / a.bpm : 0.5;
  const pad = context * 4 * beatA;
  const window_ =
    a && b && info
      ? { from: Math.min(info.inAt, info.outAt) - pad, to: Math.max(info.inAt, info.outAt) + pad }
      : { from: 0, to: 1 };
  // While the incoming track is dragged, the view holds still under the pointer.
  const [frozen, setFrozen] = useState<{ from: number; to: number } | null>(null);
  const view = frozen ?? window_;

  const preview = () => {
    if (!info || !a) return;
    if (night.playing && night.position() >= view.from && night.position() <= view.to) return night.pause();
    night.play(Math.max(a.startsAt, Math.min(info.inAt, info.outAt) - Math.min(pad, 8 * 4 * beatA)));
  };

  if (!pair || !a || !b || !info) {
    return (
      <div className="transition-view empty" ref={fitRef}>
        <div className="pane-head">
          <h3>Transition</h3>
        </div>
        <p className="muted">
          Put two tracks in the journey of the night to see their transition here: both waveforms on one timeline,
          lined up as they'll play.
        </p>
      </div>
    );
  }

  const rel = keyRelation(ta?.key, tb?.key);
  const blend = info.overlap > 0.05;
  const gap = info.overlap < -0.05;
  const bpmWarn = info.bpmChange !== undefined && Math.abs(info.bpmChange) > 6;
  const lands = info.landsOn;

  return (
    <div className="transition-view" ref={fitRef}>
      <div className="pane-head">
        <h3>Transition</h3>
        <div className="tv-nav">
          <button className="icon" onClick={() => setIndex(Math.max(0, i - 1))} disabled={i === 0} title="Previous transition">
            ‹
          </button>
          <span className="small-text">
            {i + 1} of {pairs.length}
          </span>
          <button
            className="icon"
            onClick={() => setIndex(Math.min(pairs.length - 1, i + 1))}
            disabled={i >= pairs.length - 1}
            title="Next transition"
          >
            ›
          </button>
        </div>
        <button className={`small tv-preview ${nightState.playing ? 'on' : ''}`} onClick={preview} title="Play the night from a few bars before the incoming track">
          {nightState.playing ? '❚❚ Pause' : '▶ Preview transition'}
        </button>
        <span className="tv-chips">
          <span className={`chip ${blend ? 'ok' : gap ? 'bad' : ''}`}>
            {blend
              ? `Blend · ${info.overlapBars !== undefined ? `${info.overlapBars} bars` : `${info.overlap.toFixed(1)} s`}`
              : gap
                ? `Gap · ${(-info.overlap).toFixed(1)} s of silence`
                : 'Cut'}
          </span>
          {info.bpmChange !== undefined && (
            <span className={`chip ${bpmWarn ? 'warn' : 'ok'}`}>
              {ta?.bpm?.toFixed(0)} → {tb?.bpm?.toFixed(0)} BPM ({info.bpmChange > 0 ? '+' : ''}
              {info.bpmChange}%)
            </span>
          )}
          <span className={`chip ${rel === 'clash' ? 'bad' : rel === 'unknown' ? '' : rel === 'boost' ? 'warn' : 'ok'}`}>
            {ta?.key ? toCamelot(ta.key) : '?'} → {tb?.key ? toCamelot(tb.key) : '?'} · {RELATION_TEXT[rel]}
          </span>
          {lands && (
            <span
              className={`chip ${lands.phrase ? 'ok' : Math.abs(lands.offBeats) > 0.05 ? 'warn' : ''}`}
              title="Where the incoming track starts, counted in the outgoing track's bars"
            >
              In on bar {lands.bar}.{lands.beat}
              {Math.abs(lands.offBeats) > 0.05
                ? ` · ${Math.abs(lands.offBeats)} beat off the grid`
                : lands.phrase
                  ? ' · on a phrase ✓'
                  : lands.beat === 1
                    ? ' · on the bar'
                    : ''}
            </span>
          )}
        </span>
        <span className="grow" />
        <label className="inline small-text muted" title="How much of each track to show around the join">
          Show
          <select value={context} onChange={(e) => setContext(Number(e.target.value) as (typeof CONTEXT_BARS)[number])}>
            {CONTEXT_BARS.map((n) => (
              <option key={n} value={n}>
                ±{n} bars
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="tv-body">
        <DeckCard side="A" label="Out" track={ta} note={`out ${formatTime(a.mixIn + a.playFor, false)}`} onOpen={() => onSelectTrack(a.trackId)} />
        <TransitionCanvas
          a={a}
          b={b}
          ta={ta}
          tb={tb}
          waveA={waveA.wave}
          waveB={waveB.wave}
          sectionsA={waveA.sections}
          sectionsB={waveB.sections}
          loadingA={waveA.loading}
          loadingB={waveB.loading}
          view={view}
          inAt={info.inAt}
          outAt={info.outAt}
          slots={slots}
          onDragStart={() => setFrozen(view)}
          onDragEnd={() => setFrozen(null)}
          onMoveIn={(at) => dispatch({ type: 'setEntryTime', id: b.id, at })}
        />
        <DeckCard side="B" label="In" track={tb} note={`from ${formatTime(b.mixIn, false)}`} onOpen={() => onSelectTrack(b.trackId)} />
      </div>
    </div>
  );
}

function DeckCard({ side, label, track, note, onOpen }: { side: 'A' | 'B'; label: string; track?: Track; note: string; onOpen: () => void }) {
  return (
    <div className={`tv-deck tv-deck-${side.toLowerCase()}`}>
      <span className="tv-deck-top">
        <span className="tv-side">
          {side} · {label}
        </span>
        <button className="link small" onClick={onOpen} title="Open in the deck to set its cues">
          Edit cues
        </button>
      </span>
      <b title={track ? `${track.artist} – ${track.title}` : ''}>{track?.title ?? 'Missing track'}</b>
      <span className="tv-facts">
        {track?.bpm ? <span>{track.bpm.toFixed(1)}</span> : <span className="muted">no BPM</span>}
        {track?.key && (
          <i className="key-pill" style={{ background: keyColor(track.key) }}>
            {toCamelot(track.key)}
          </i>
        )}
        <span className="muted">{note}</span>
      </span>
    </div>
  );
}

interface CanvasProps {
  a: NightSlot;
  b: NightSlot;
  ta?: Track;
  tb?: Track;
  waveA?: WaveformData;
  waveB?: WaveformData;
  sectionsA: Section[];
  sectionsB: Section[];
  loadingA: boolean;
  loadingB: boolean;
  view: { from: number; to: number };
  inAt: number;
  outAt: number;
  slots: NightSlot[];
  onDragStart: () => void;
  onDragEnd: () => void;
  onMoveIn: (at: number) => void;
}

function TransitionCanvas(p: CanvasProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const playheadEl = useRef<HTMLDivElement>(null);
  const readoutEl = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const night = useNight();
  const props = useRef(p);
  props.current = p;
  const drag = useRef<
    | { kind: 'move'; startX: number; origAt: number; moved: boolean }
    | { kind: 'scrub'; startX: number; moved: boolean }
    | null
  >(null);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ro = new ResizeObserver(() => setSize({ w: c.clientWidth, h: c.clientHeight }));
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  const tAt = (clientX: number) => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    const { from, to } = props.current.view;
    return from + ((clientX - r.left) / r.width) * (to - from);
  };

  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c || !size.w || !size.h) return;
    const dpr = (window.devicePixelRatio || 1) * zoomOf(c);
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, size.w, size.h, p);
  }, [size, p]);

  // The playhead: the night's position, or the deck's when it's playing one of these tracks.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const { view, slots } = props.current;
      let t: number | null = null;
      if (night.active) t = night.position();
      else {
        const pos = transport.position;
        const s = pos && slots.find((x) => x.trackId === pos.trackId);
        if (pos && s) t = s.startsAt + (pos.pos - s.mixIn);
      }
      const el = playheadEl.current;
      if (el) {
        const inView = t !== null && t >= view.from && t <= view.to;
        el.style.display = inView ? '' : 'none';
        if (inView) el.style.left = `${((t! - view.from) / (view.to - view.from)) * 100}%`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [night]);

  /** Snap a start time for the incoming track onto the outgoing track's beats. */
  const snapIn = useCallback((t: number, free: boolean) => {
    const { a } = props.current;
    if (free || !a.bpm) return Math.max(0, Math.round(t * 1000) / 1000);
    const beat = 60 / a.bpm;
    // A's beat k is at night time a.startsAt + (grid + k·beat − mixIn).
    const origin = a.startsAt + (a.gridStart ?? 0) - a.mixIn;
    return Math.max(0, Math.round((origin + Math.round((t - origin) / beat) * beat) * 1000) / 1000);
  }, []);

  const showReadout = (text: string | null, x = 0) => {
    const el = readoutEl.current;
    if (!el) return;
    el.style.display = text ? '' : 'none';
    if (text) {
      el.textContent = text;
      el.style.left = `${x}px`;
    }
  };

  return (
    <div className="tv-canvas-wrap">
      <canvas
        ref={canvas}
        className="tv-canvas"
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const lowerHalf = e.clientY - r.top > r.height / 2;
          e.currentTarget.setPointerCapture(e.pointerId);
          // The incoming track's row: grab it to move where it comes in. Elsewhere: scrub the night.
          if (lowerHalf) {
            drag.current = { kind: 'move', startX: e.clientX, origAt: props.current.b.startsAt, moved: false };
            props.current.onDragStart();
          } else drag.current = { kind: 'scrub', startX: e.clientX, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          const r = e.currentTarget.getBoundingClientRect();
          e.currentTarget.style.cursor = e.clientY - r.top > r.height / 2 ? 'grab' : 'text';
          if (!d) return;
          if (!d.moved && Math.abs(e.clientX - d.startX) < 3) return;
          if (d.kind === 'move') {
            d.moved = true;
            const { view } = props.current;
            const dt = ((e.clientX - d.startX) / r.width) * (view.to - view.from);
            const at = snapIn(d.origAt + dt, e.shiftKey);
            props.current.onMoveIn(at);
            const info = describeTransition(props.current.a, { ...props.current.b, startsAt: at });
            showReadout(
              `in at ${formatTime(at)}${info.landsOn ? ` · A bar ${info.landsOn.bar}.${info.landsOn.beat}` : ''}${
                info.overlap > 0 && info.overlapBars !== undefined ? ` · ${info.overlapBars} bar blend` : ''
              }`,
              e.clientX - r.left,
            );
          } else {
            if (!d.moved) night.scrubStart();
            d.moved = true;
            night.scrubTo(tAt(e.clientX));
          }
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          showReadout(null);
          if (!d) return;
          if (d.kind === 'move') props.current.onDragEnd();
          if (d.kind === 'scrub' && d.moved) night.scrubEnd();
          // A click (either row) jumps the night there.
          if (!d.moved) night.seek(tAt(e.clientX));
        }}
        onPointerCancel={() => {
          const d = drag.current;
          drag.current = null;
          showReadout(null);
          if (d?.kind === 'move') props.current.onDragEnd();
          if (d?.kind === 'scrub' && d.moved) night.scrubEnd();
        }}
      />
      <div className="tv-playhead" ref={playheadEl} aria-hidden />
      <div className="tv-readout" ref={readoutEl} style={{ display: 'none' }} />
    </div>
  );
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, p: CanvasProps) {
  const { view, a, b, inAt, outAt } = p;
  const span = view.to - view.from;
  const xOf = (t: number) => ((t - view.from) / span) * w;
  const rowH = (h - 2) / 2;
  ctx.fillStyle = '#07070a';
  ctx.fillRect(0, 0, w, h);

  // Where both play: highlighted across both decks. A gap is marked red.
  if (outAt > inAt) {
    ctx.fillStyle = 'rgba(34, 211, 238, 0.09)';
    ctx.fillRect(xOf(inAt), 0, xOf(outAt) - xOf(inAt), h);
  } else if (outAt < inAt) {
    ctx.fillStyle = 'rgba(244, 63, 94, 0.14)';
    ctx.fillRect(xOf(outAt), 0, xOf(inAt) - xOf(outAt), h);
  }

  drawRow(ctx, w, 0, rowH, a, p.waveA, p.sectionsA, xOf, view, p.ta, p.loadingA, 'A');
  drawRow(ctx, w, rowH + 2, rowH, b, p.waveB, p.sectionsB, xOf, view, p.tb, p.loadingB, 'B');
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, rowH, w, 2);

  // In and out lines, full height.
  const line = (t: number, color: string, label: string, top: boolean) => {
    const x = Math.round(xOf(t));
    if (x < -40 || x > w + 40) return;
    ctx.fillStyle = color;
    ctx.fillRect(x - 1, 0, 2, h);
    ctx.font = 'bold 10px system-ui';
    const tw = ctx.measureText(label).width;
    const lx = Math.min(Math.max(x + 4, 2), w - tw - 8);
    const ly = top ? rowH - 17 : h - 16;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(lx - 3, ly, tw + 6, 13);
    ctx.fillStyle = color;
    ctx.fillText(label, lx, ly + 10);
  };
  line(outAt, OUT_COLOR, 'A OUT ◂', true);
  line(inAt, IN_COLOR, '▸ B IN', false);
}

function drawRow(
  ctx: CanvasRenderingContext2D,
  w: number,
  y0: number,
  h: number,
  slot: NightSlot,
  wave: WaveformData | undefined,
  sections: Section[],
  xOf: (t: number) => number,
  view: { from: number; to: number },
  track: Track | undefined,
  loading: boolean,
  side: 'A' | 'B',
) {
  const span = view.to - view.from;
  const start = slot.startsAt;
  const end = slot.startsAt + slot.playFor;
  // Night time → spot in this track's file.
  const posOf = (t: number) => slot.mixIn + (t - start);
  const mid = y0 + h / 2;

  // Beat grid in this track's own tempo: bars faint, every 8 bars brighter.
  if (track?.bpm) {
    const beat = 60 / track.bpm;
    const grid = track.gridStart ?? 0;
    const k0 = Math.ceil((posOf(view.from) - grid) / beat);
    const k1 = Math.floor((posOf(view.to) - grid) / beat);
    if ((k1 - k0) / 4 < w / 6) {
      for (let k = k0; k <= k1; k++) {
        if (k % 4) continue;
        const x = Math.round(xOf(start + (grid + k * beat - slot.mixIn)));
        ctx.fillStyle = k % 32 === 0 ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.08)';
        ctx.fillRect(x, y0, 1, h);
      }
    }
  }

  if (wave) {
    // Sections as a thin coloured strip along the top of the row.
    for (const s of sections) {
      const x0 = xOf(start + s.start - slot.mixIn);
      const x1 = xOf(start + s.end - slot.mixIn);
      if (x1 < 0 || x0 > w) continue;
      ctx.fillStyle = SECTION_COLORS[s.kind];
      ctx.globalAlpha = 0.85;
      ctx.fillRect(Math.max(0, x0), y0, Math.min(w, x1) - Math.max(0, x0), 3);
      ctx.globalAlpha = 1;
    }
    const pps = wave.peaksPerSecond;
    let max = 0.05;
    for (const v of wave.peaks) if (v > max) max = v;
    const layers: [Float32Array, string, number][] = wave.bands
      ? [
          [wave.bands.low, COLORS.low, 1],
          [wave.bands.mid, COLORS.mid, 0.95],
          [wave.bands.high, COLORS.high, 0.75],
        ]
      : [[wave.peaks, COLORS.low, 1]];
    const amp = (h / 2 - 5) / max;
    for (const [arr, color, boost] of layers) {
      ctx.fillStyle = color;
      for (let x = 0; x < w; x++) {
        const t0 = view.from + (x / w) * span;
        const t1 = view.from + ((x + 1) / w) * span;
        const p0 = posOf(t0);
        if (p0 < 0 || p0 > wave.duration) continue;
        const i0 = Math.max(0, Math.floor(p0 * pps));
        const i1 = Math.max(i0 + 1, Math.floor(posOf(t1) * pps));
        let m = 0;
        for (let i = i0; i < i1 && i < arr.length; i++) if (arr[i] > m) m = arr[i];
        const a = m * boost * amp;
        if (a < 0.4) continue;
        // What the night plays is solid; the rest of the file (before the mix-in, after the out) is ghosted.
        ctx.globalAlpha = t0 >= start && t0 < end ? 1 : 0.18;
        ctx.fillRect(x, mid - a, 1, a * 2);
      }
    }
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '12px system-ui';
    ctx.fillText(loading ? 'Analysing…' : 'No waveform yet: link your music folder or attach the file', 60, mid + 4);
  }

  // Outside what the night plays of this track: dimmed.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  if (xOf(start) > 0) ctx.fillRect(0, y0, Math.min(w, xOf(start)), h);
  if (xOf(end) < w) ctx.fillRect(Math.max(0, xOf(end)), y0, w - Math.max(0, xOf(end)), h);

  // Deck label.
  ctx.font = 'bold 11px system-ui';
  const label = `${side}  ${track?.title ?? ''}`;
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(4, y0 + 6, tw + 10, 16);
  ctx.fillStyle = side === 'A' ? OUT_COLOR : IN_COLOR;
  ctx.fillText(side, 9, y0 + 18);
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.fillText(label.slice(1), 9 + ctx.measureText(side).width, y0 + 18);
}
