import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { keyColor, keyRelation, toCamelot, type KeyRelation } from '../core/keys';
import type { Track } from '../core/model';
import type { Section } from '../core/sections';
import {
  AUTO_PARAMS,
  BLEND_STYLES,
  MAX_PITCH,
  autoParam,
  incomingCurves,
  isCustomBlend,
  outgoingCurves,
  seedKeyframes,
  snapIncoming,
  valueAt,
  type AutoParam,
  type BlendStyle,
  type Keyframe,
  type TransitionAutomation,
  type TransitionPlan,
} from '../core/mixplan';
import { buildTimeline, describeTransition, nightSlots, slotPos, transitionsOf, type NightSlot } from '../core/setplan';
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
  /** Keyframes mode: the parameter being drawn (null: the normal view). */
  const [editParam, setEditParam] = useState<AutoParam | null>(null);
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
  const plan = pair?.plan;
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

  const previewFrom = info && a ? Math.max(a.startsAt, Math.min(info.inAt, info.outAt) - Math.min(pad, 8 * 4 * beatA)) : 0;
  const preview = () => {
    if (!info || !a) return;
    if (night.playing && night.position() >= view.from && night.position() <= view.to) return night.pause();
    night.play(previewFrom);
  };
  // Loop the transition: from a few bars before it to a few bars after, over and over, while you tweak it.
  const loopRegion = info ? { from: previewFrom, to: Math.max(info.inAt, info.outAt) + 4 * 4 * beatA } : null;
  const looping = !!night.loop && !!loopRegion && Math.abs(night.loop.from - loopRegion.from) < 0.01;
  const toggleLoop = () => {
    if (looping || !loopRegion) return night.setLoop(null);
    night.setLoop(loopRegion);
    if (!night.playing || night.position() < loopRegion.from || night.position() > loopRegion.to) night.play(loopRegion.from);
  };
  // Another transition on show: stop looping the last one.
  const shownId = b?.id;
  useEffect(() => {
    night.setLoop(null);
  }, [shownId, night]);

  if (!pair || !a || !b || !info || !plan) {
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
  const lands = info.landsOn;
  const auto = b.automation;
  const custom = isCustomBlend(auto);
  // Picking a blend style hands the fader and bass back to it (drawn effects stay).
  const setBlend = (blend: BlendStyle) => {
    const strip = (d?: TransitionAutomation['a']) => (d ? { ...d, level: undefined, bass: undefined } : d);
    dispatch({ type: 'updateEntry', id: b.id, patch: { blend, automation: auto ? { a: strip(auto.a), b: strip(auto.b) } : undefined } });
  };
  const setKeys = (deck: 'a' | 'b', param: AutoParam, keys: Keyframe[] | undefined) =>
    dispatch({
      type: 'updateEntry',
      id: b.id,
      patch: { automation: { ...auto, [deck]: { ...auto?.[deck], [param]: keys?.length ? keys : undefined } } },
    });
  const hasKeys = !!auto && Object.values({ ...auto.a, ...auto.b }).some((l) => l?.length);
  const syncOn = b.sync !== false;
  const tempoChip = tempoText(plan, ta, tb);

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
        <div className="seg" role="group" aria-label="Preview">
          <button className={`small tv-preview ${nightState.playing ? 'on' : ''}`} onClick={preview} title="Play the night from a few bars before the incoming track">
            {nightState.playing ? '❚❚ Pause' : '▶ Preview'}
          </button>
          <button
            className={`small tv-loop ${looping ? 'on' : ''}`}
            onClick={toggleLoop}
            title="Loop the transition, so you can hear your changes over and over"
            aria-pressed={looping}
          >
            ⟲ Loop
          </button>
        </div>
        <label className="inline small-text tv-blend" title={custom ? 'The fader and bass follow your keyframes' : BLEND_STYLES.find((x) => x.id === plan.style)?.hint}>
          <select aria-label="Blend" value={custom ? 'custom' : (plan.chosen ?? plan.style)} onChange={(e) => setBlend(e.target.value as BlendStyle)}>
            {custom && <option value="custom">Custom (keyframes)</option>}
            {BLEND_STYLES.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
                {!plan.chosen && x.id === plan.style ? ' (auto)' : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="seg" role="group" aria-label="Mix">
        <button
          className={`small tv-sync ${syncOn ? 'on' : ''}`}
          onClick={() => dispatch({ type: 'updateEntry', id: b.id, patch: { sync: !syncOn } })}
          title="Sync: the outgoing track rides into the incoming tempo over the 8 bars before it comes in, so the beats lock (it changes pitch a little, like a turntable)"
          aria-pressed={syncOn}
        >
          Sync
        </button>
        <button
          className={`small tv-keys ${editParam ? 'on' : ''}`}
          onClick={() => setEditParam(editParam ? null : 'level')}
          title="Draw keyframes: fader, EQ, filter, echo and reverb on either deck"
          aria-pressed={!!editParam}
        >
          ✎ Keyframes
        </button>
        </div>
        {editParam ? (
          <span className="tv-params" role="group" aria-label="Parameter">
            {AUTO_PARAMS.map((pr) => {
              const n = (auto?.a?.[pr.id]?.length ?? 0) + (auto?.b?.[pr.id]?.length ?? 0);
              return (
                <button key={pr.id} className={`small ${editParam === pr.id ? 'on' : ''}`} onClick={() => setEditParam(pr.id)} title={pr.hint}>
                  {pr.label}
                  {n > 0 && <i className="tv-count">{n}</i>}
                </button>
              );
            })}
            {hasKeys && (
              <button
                className="small link"
                onClick={() => dispatch({ type: 'updateEntry', id: b.id, patch: { automation: undefined } })}
                title="Remove every keyframe of this transition (back to its blend style)"
              >
                Clear
              </button>
            )}
          </span>
        ) : (
          <>
        <span className="tv-chips">
          <span className={`chip ${blend ? 'ok' : gap ? 'bad' : ''}`}>
            {blend
              ? info.overlapBars !== undefined
                ? `${info.overlapBars}-bar blend`
                : `${info.overlap.toFixed(1)} s blend`
              : gap
                ? `${(-info.overlap).toFixed(1)} s gap`
                : 'Cut'}
          </span>
          {tempoChip && (
            <span className={`chip ${tempoChip.tone}`} title={tempoChip.title}>
              {tempoChip.text}
            </span>
          )}
          <span className={`chip ${rel === 'clash' ? 'bad' : rel === 'unknown' ? '' : rel === 'boost' ? 'warn' : 'ok'}`}>
            {ta?.key ? toCamelot(ta.key) : '?'}→{tb?.key ? toCamelot(tb.key) : '?'} {RELATION_TEXT[rel]}
          </span>
          {lands && (
            <span
              className={`chip ${lands.phrase ? 'ok' : Math.abs(lands.offBeats) > 0.05 ? 'warn' : ''}`}
              title="Where the incoming track starts, counted in the outgoing track's bars"
            >
              In on bar {lands.bar}.{lands.beat}
              {Math.abs(lands.offBeats) > 0.05
                ? ` · ${Math.abs(lands.offBeats)} beat off`
                : lands.phrase
                  ? ' · on a phrase ✓'
                  : lands.beat === 1
                    ? ' · on the bar'
                    : ''}
            </span>
          )}
        </span>
          </>
        )}
        <span className="grow" />
        <label className="inline small-text muted" title="How much of each track to show around the join">
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
          plan={plan}
          inAt={info.inAt}
          outAt={info.outAt}
          slots={slots}
          onDragStart={() => setFrozen(view)}
          onDragEnd={() => setFrozen(null)}
          onMoveIn={(at) => dispatch({ type: 'setEntryTime', id: b.id, at })}
          editParam={editParam}
          onKeys={setKeys}
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
  plan: TransitionPlan;
  inAt: number;
  outAt: number;
  slots: NightSlot[];
  onDragStart: () => void;
  onDragEnd: () => void;
  onMoveIn: (at: number) => void;
  /** Keyframes mode: the parameter being drawn. */
  editParam: AutoParam | null;
  onKeys: (deck: 'a' | 'b', param: AutoParam, keys: Keyframe[] | undefined) => void;
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
    | { kind: 'key'; deck: 'a' | 'b'; param: AutoParam; index: number; keys: Keyframe[] }
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

  /** Snap a start time for the incoming track onto the outgoing track's beats as they're played (after its tempo ride). */
  const snapIn = useCallback((t: number, free: boolean) => {
    const { a, b } = props.current;
    if (free) return Math.max(0, Math.round(t * 1000) / 1000);
    return snapIncoming(a, b, t, b.sync !== false);
  }, []);

  /** The pointer in the canvas's own (CSS pixel) coordinates, whatever the panel's zoom. */
  const local = (e: { clientX: number; clientY: number }) => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.clientWidth, y: ((e.clientY - r.top) / r.height) * c.clientHeight };
  };
  const geometry = () => {
    const c = canvas.current!;
    const { view } = props.current;
    const w = c.clientWidth;
    const rowH = (c.clientHeight - 2) / 2;
    return { w, rowH, xOf: (t: number) => ((t - view.from) / (view.to - view.from)) * w, tOf: (x: number) => view.from + (x / w) * (view.to - view.from) };
  };
  const deckAt = (y: number): 'a' | 'b' => (y > geometry().rowH + 1 ? 'b' : 'a');
  /** The keyframe under the pointer, on the parameter being drawn. */
  const keyAt = (pt: { x: number; y: number }) => {
    const { editParam, b, inAt } = props.current;
    if (!editParam) return null;
    const deck = deckAt(pt.y);
    const { rowH, xOf } = geometry();
    const keys = b.automation?.[deck]?.[editParam] ?? [];
    const y0 = deck === 'a' ? 0 : rowH + 2;
    const i = keys.findIndex((k) => Math.hypot(xOf(inAt + k.t) - pt.x, keyY(editParam, k.v, y0, rowH) - pt.y) <= 8);
    return i >= 0 ? { deck, i, keys } : null;
  };
  /** A keyframe time (from B's in), snapped to the incoming track's beats. */
  const snapKey = (t: number, free: boolean) => {
    const { b, inAt } = props.current;
    if (free || !b.bpm) return Math.round((t - inAt) * 100) / 100;
    const beat = 60 / b.bpm;
    const origin = inAt + (b.gridStart ?? 0) - b.mixIn;
    return Math.round((origin + Math.round((t - origin) / beat) * beat - inAt) * 1000) / 1000;
  };
  const keyText = (param: AutoParam, k: Keyframe) => {
    const { b } = props.current;
    const bars = b.bpm ? k.t / ((60 / b.bpm) * 4) : undefined;
    const when =
      bars === undefined
        ? `${k.t >= 0 ? '+' : ''}${k.t.toFixed(1)} s`
        : Math.abs(bars) < 0.05
          ? 'at B in'
          : `${Math.abs(Math.round(bars * 4) / 4)} bars ${bars > 0 ? 'after' : 'before'} B in`;
    return `${autoParam(param).label} ${autoParam(param).format(k.v)} · ${when}`;
  };

  const removeKey = (e: { clientX: number; clientY: number }) => {
    const { editParam } = props.current;
    const hit = editParam && keyAt(local(e));
    if (!editParam || !hit) return;
    props.current.onKeys(hit.deck, editParam, hit.keys.filter((_, j) => j !== hit.i));
  };

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
          const { editParam } = props.current;
          if (editParam) {
            // Keyframes: grab one, or click anywhere on a deck to add one there and drag it.
            if (e.button !== 0) return;
            const pt = local(e);
            const hit = keyAt(pt);
            if (hit) {
              drag.current = { kind: 'key', deck: hit.deck, param: editParam, index: hit.i, keys: [...hit.keys] };
              return;
            }
            const { a, b, plan, inAt } = props.current;
            const deck = deckAt(pt.y);
            const { rowH, tOf } = geometry();
            const k = { t: snapKey(tOf(pt.x), e.shiftKey), v: keyValue(editParam, pt.y, deck === 'a' ? 0 : rowH + 2, rowH) };
            const existing = b.automation?.[deck]?.[editParam];
            const bar = (b.bpm ? 60 / b.bpm : 0.5) * 4;
            const keys = existing?.length
              ? [...existing, k].sort((x, y) => x.t - y.t)
              : seedKeyframes(deck === 'a' ? outgoingCurves(plan, a) : incomingCurves(plan, b), editParam, inAt, k, bar);
            props.current.onKeys(deck, editParam, keys);
            drag.current = { kind: 'key', deck, param: editParam, index: keys.indexOf(k), keys };
            showReadout(keyText(editParam, k), pt.x);
            return;
          }
          // The incoming track's row: grab it to move where it comes in. Elsewhere: scrub the night.
          if (lowerHalf) {
            drag.current = { kind: 'move', startX: e.clientX, origAt: props.current.b.startsAt, moved: false };
            props.current.onDragStart();
          } else drag.current = { kind: 'scrub', startX: e.clientX, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          const r = e.currentTarget.getBoundingClientRect();
          if (props.current.editParam) {
            const pt = local(e);
            e.currentTarget.style.cursor = d?.kind === 'key' ? 'grabbing' : keyAt(pt) ? 'grab' : 'crosshair';
            if (d?.kind !== 'key') return;
            // Drag a keyframe: its time snaps to beats (Shift: free) and can't pass its neighbours.
            const { rowH, tOf } = geometry();
            const prev = d.keys[d.index - 1];
            const next = d.keys[d.index + 1];
            let t = snapKey(tOf(pt.x), e.shiftKey);
            if (prev) t = Math.max(prev.t + 0.01, t);
            if (next) t = Math.min(next.t - 0.01, t);
            const k = { t, v: keyValue(d.param, pt.y, d.deck === 'a' ? 0 : rowH + 2, rowH) };
            d.keys = d.keys.map((x, j) => (j === d.index ? k : x));
            props.current.onKeys(d.deck, d.param, d.keys);
            showReadout(keyText(d.param, k), pt.x);
            return;
          }
          e.currentTarget.style.cursor = e.clientY - r.top > r.height / 2 ? 'grab' : 'text';
          if (!d) return;
          if (d.kind === 'key') return;
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
          if (!d || d.kind === 'key') return;
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
        // Double-click (or right-click) a keyframe to remove it.
        onDoubleClick={(e) => removeKey(e)}
        onContextMenu={(e) => {
          if (props.current.editParam && keyAt(local(e))) {
            e.preventDefault();
            removeKey(e);
          }
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
  const plan = p.plan;
  // The tempo ride: a strip along the top of the outgoing deck, from where it starts riding.
  if (plan.sync) {
    const x0 = Math.max(0, xOf(plan.sync.rideFrom));
    const x1 = Math.min(w, xOf(plan.sync.rideTo));
    const x2 = Math.min(w, xOf(outAt));
    const grad = ctx.createLinearGradient(x0, 0, Math.max(x0 + 1, x1), 0);
    grad.addColorStop(0, 'rgba(167,139,250,0)');
    grad.addColorStop(1, 'rgba(167,139,250,0.9)');
    ctx.fillStyle = grad;
    ctx.fillRect(x0, rowH - 5, Math.max(0, x1 - x0), 3);
    ctx.fillStyle = 'rgba(167,139,250,0.9)';
    ctx.fillRect(x1, rowH - 5, Math.max(0, x2 - x1), 3);
    if (x0 < w - 40) {
      const text = `TEMPO RIDE → ${a.bpm ? (a.bpm * plan.sync.rate).toFixed(1) : ''} BPM`;
      ctx.font = 'bold 9px system-ui';
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(x0 + 2, rowH - 18, ctx.measureText(text).width + 6, 12);
      ctx.fillStyle = '#c4b5fd';
      ctx.fillText(text, x0 + 5, rowH - 9);
    }
  }
  if (plan.swapAt !== undefined) {
    const x = Math.round(xOf(plan.swapAt));
    ctx.fillStyle = '#fbbf24';
    for (let y = 0; y < h; y += 6) ctx.fillRect(x - 1, y, 2, 3);
    ctx.font = 'bold 10px system-ui';
    const text = '⇅ BASS SWAP';
    const tw = ctx.measureText(text).width;
    const lx = Math.min(Math.max(x + 4, 2), w - tw - 8);
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(lx - 3, rowH + 6, tw + 6, 13);
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(text, lx, rowH + 16);
  }
  line(outAt, OUT_COLOR, plan.style === 'echo' ? 'ECHO OUT ◂' : 'A OUT ◂', true);
  line(inAt, IN_COLOR, '▸ B IN', false);
  if (p.editParam) drawKeys(ctx, w, rowH, xOf, p, p.editParam);
}

const KEY_PAD = 9;
/** Where a value sits in a deck's row (top = the parameter's maximum). */
function keyY(param: AutoParam, v: number, y0: number, rowH: number): number {
  const info = autoParam(param);
  const f = (v - info.min) / (info.max - info.min);
  return y0 + KEY_PAD + (1 - f) * (rowH - 2 * KEY_PAD);
}
function keyValue(param: AutoParam, y: number, y0: number, rowH: number): number {
  const info = autoParam(param);
  const f = 1 - (y - y0 - KEY_PAD) / (rowH - 2 * KEY_PAD);
  const v = info.min + Math.max(0, Math.min(1, f)) * (info.max - info.min);
  // Close to neutral clicks onto it, so "back to normal" is easy to hit.
  const near = (info.max - info.min) * 0.03;
  return Math.abs(v - info.neutral) < near ? info.neutral : Math.round(v * 100) / 100;
}

/** Keyframes mode: each deck's curve for the parameter, with its keyframes as dots. */
function drawKeys(ctx: CanvasRenderingContext2D, w: number, rowH: number, xOf: (t: number) => number, p: CanvasProps, param: AutoParam) {
  const info = autoParam(param);
  const span = p.view.to - p.view.from;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, w, rowH * 2 + 2);
  (['a', 'b'] as const).forEach((deck) => {
    const slot = deck === 'a' ? p.a : p.b;
    const y0 = deck === 'a' ? 0 : rowH + 2;
    const color = deck === 'a' ? OUT_COLOR : IN_COLOR;
    // The neutral line: where the sound is untouched.
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    const ny = Math.round(keyY(param, info.neutral, y0, rowH));
    for (let x = 0; x < w; x += 8) ctx.fillRect(x, ny, 4, 1);
    // The curve the deck follows (the blend style's, or the keyframes'), solid while it plays.
    const env = slot.curves[param];
    const start = slot.startsAt;
    const end = slot.startsAt + slot.playFor;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 2) {
      const t = p.view.from + (x / w) * span;
      const y = keyY(param, valueAt(env, t, info.neutral), y0, rowH);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.globalAlpha = 0.95;
    ctx.save();
    ctx.beginPath();
    ctx.rect(Math.max(0, xOf(start)), y0, Math.max(0, Math.min(w, xOf(end)) - Math.max(0, xOf(start))), rowH);
    ctx.clip();
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
    const keys = p.b.automation?.[deck]?.[param] ?? [];
    for (const k of keys) {
      const x = xOf(p.inAt + k.t);
      const y = keyY(param, k.v, y0, rowH);
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
    }
    ctx.font = 'bold 10px system-ui';
    const label = `${deck.toUpperCase()} · ${info.label}${keys.length ? '' : env.length ? ' · click to edit the blend’s curve' : ' · click to add a keyframe'}`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(w - tw - 14, y0 + 5, tw + 8, 14);
    ctx.fillStyle = color;
    ctx.fillText(label, w - tw - 10, y0 + 15);
  });
}

/** The tempo chip: synced (and how far it pitches), or why not. */
function tempoText(plan: TransitionPlan, ta?: Track, tb?: Track): { text: string; tone: string; title: string } | undefined {
  const from = ta?.bpm?.toFixed(0);
  const to = tb?.bpm?.toFixed(0);
  if (plan.sync) {
    const pct = Math.round((plan.sync.rate - 1) * 1000) / 10;
    return {
      text: `Synced ${from}→${to} (${pct > 0 ? '+' : ''}${pct}%)`,
      tone: Math.abs(pct) > 8 ? 'warn' : 'ok',
      title: `The outgoing track rides from ${from} into ${to} BPM over the 8 bars before the incoming one, so the beats lock. ${
        Math.abs(pct) > 8 ? 'That much pitch change is noticeable; ' : ''
      }Turn Sync off to hear them at their own tempos.`,
    };
  }
  switch (plan.noSync) {
    case 'same-tempo':
      return { text: `Same tempo ${to}`, tone: 'ok', title: 'Both tracks are at the same tempo.' };
    case 'off':
      return {
        text: `Not synced ${from}→${to}`,
        tone: from && to && from !== to ? 'warn' : '',
        title: 'Sync is off: both tracks play at their own tempo, so the beats drift apart during the blend.',
      };
    case 'too-far':
      return {
        text: `${from}→${to} too far to sync`,
        tone: 'bad',
        title: `More than ${Math.round(MAX_PITCH * 100)}% apart: a cut or an echo out suits this better than a blend.`,
      };
    case 'no-bpm':
      return { text: 'No BPM to sync', tone: 'warn', title: 'Set both tracks’ BPM to sync their tempos.' };
    default:
      return from && to ? { text: `${from} → ${to} BPM`, tone: '', title: 'A cut: no overlap to sync.' } : undefined;
  }
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
  const mid = y0 + h / 2;
  // Night time → spot in this track's file, following its tempo ride: where it speeds up,
  // its waveform and grid squeeze together, so the beats visibly line up with the other deck.
  const tOf = (x: number) => view.from + (x / w) * span;
  const cols = new Float64Array(w + 1);
  for (let x = 0; x <= w; x++) cols[x] = slotPos(slot, tOf(x));

  // Beat grid in this track's own tempo: bars faint, every 8 bars brighter.
  if (track?.bpm) {
    const bar = (60 / track.bpm) * 4;
    const grid = track.gridStart ?? 0;
    if ((cols[w] - cols[0]) / bar < w / 6) {
      for (let x = 0; x < w; x++) {
        const k0 = Math.floor((cols[x] - grid) / bar);
        const k1 = Math.floor((cols[x + 1] - grid) / bar);
        if (k1 === k0) continue;
        ctx.fillStyle = k1 % 8 === 0 ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.08)';
        ctx.fillRect(x, y0, 1, h);
      }
    }
  }

  if (wave) {
    // Sections as a thin coloured strip along the top of the row.
    for (let x = 0; x < w; x++) {
      const sec = sections.find((sc) => cols[x] >= sc.start && cols[x] < sc.end);
      if (!sec) continue;
      ctx.fillStyle = SECTION_COLORS[sec.kind];
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x, y0, 1, 3);
    }
    ctx.globalAlpha = 1;
    const pps = wave.peaksPerSecond;
    let max = 0.05;
    for (const v of wave.peaks) if (v > max) max = v;
    const layers: [Float32Array, string, number, boolean][] = wave.bands
      ? [
          [wave.bands.low, COLORS.low, 1, true],
          [wave.bands.mid, COLORS.mid, 0.95, false],
          [wave.bands.high, COLORS.high, 0.75, false],
        ]
      : [[wave.peaks, COLORS.low, 1, false]];
    const amp = (h / 2 - 5) / max;
    for (const [arr, color, boost, isBass] of layers) {
      ctx.fillStyle = color;
      for (let x = 0; x < w; x++) {
        const t0 = tOf(x);
        const p0 = cols[x];
        if (p0 < 0 || p0 > wave.duration) continue;
        const i0 = Math.max(0, Math.floor(p0 * pps));
        const i1 = Math.max(i0 + 1, Math.floor(cols[x + 1] * pps));
        let m = 0;
        for (let i = i0; i < i1 && i < arr.length; i++) if (arr[i] > m) m = arr[i];
        // The fader shrinks the waveform; a bass cut dims the lows.
        const playing = t0 >= start && t0 < end;
        const level = playing ? valueAt(slot.curves.level, t0, 1) : 1;
        const a = m * boost * amp * Math.max(0.08, level);
        if (a < 0.4) continue;
        const bassCut = isBass && playing && valueAt(slot.curves.bass, t0, 0) < -10;
        // What the night plays is solid; the rest of the file (before the mix-in, after the out) is ghosted.
        ctx.globalAlpha = (playing ? 1 : 0.18) * (bassCut ? 0.16 : 1);
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
