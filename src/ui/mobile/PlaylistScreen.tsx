import { memo, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { SetEntry } from '../../core/model';
import { itemMixIn, itemStretch, nightSlots, slotKey, type TimelineItem } from '../../core/setplan';
import { setMixPoint } from '../../core/sheet';
import { shiftToKey, toCamelot, transposeKey } from '../../core/keys';
import { harmonicOrder, keysMix, matchesFilter, sortTracks, tempoFits } from '../../core/listsort';
import { notify } from '../toastBus';
import { useNight } from '../night';
import { activeSet, useStore } from '../store';
import { DotsIcon, HandleIcon } from './icons';
import { ListTools, useListPrefs } from './ListTools';
import { clockLabel, mmss, nightTime, useNightTime } from './nightModel';
import { TimeField, TrackCard } from './TrackCard';
import { WaveStrip, type StripMode } from './WaveStrip';

/** Card heights at which it shows everything / a line and its waveform / just its title. */
const FULL = 110;
const MID = 58;
/** A track is never trimmed shorter than this (seconds in the night). */
const MIN_PLAY = 4;
const ZOOM_KEY = 'setcraft-m-zoom';

/** Where everything sits on the timeline, in night seconds (with a lever's drag applied while it's dragged). */
interface Layout {
  starts: number[];
  ends: number[];
}

/** A lever being dragged: a track's end with everything after it (`end`), or its end alone (`blend`). */
type Trim = { i: number; kind: 'end' | 'blend'; d: number };

/**
 * The night as a timeline to scale, one card after another (they never
 * overlap): each card runs from when its track comes in to when the next one
 * does. A blend shows as a striped band at the top of the next card, a gap as
 * silence. A red line marks where the night is: drag it, or tap a ruler, to
 * move there. Levers: a card's bottom bar makes its track shorter or longer
 * (everything after follows); the pink bar at the bottom of a blend changes how
 * long the blend lasts.
 */
export function PlaylistScreen({
  items,
  header,
  mode,
  activeRegionId,
  loopIn,
  onAddTracks,
  footer,
}: {
  items: TimelineItem[];
  header: ReactNode;
  mode: StripMode;
  activeRegionId?: string;
  loopIn?: { entryId: string; s: number };
  onAddTracks: () => void;
  footer: ReactNode;
}) {
  const { project, dispatch } = useStore();
  const night = useNight();
  const set = activeSet(project);
  const scroller = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ idx: number; dy: number } | null>(null);
  const [trim, setTrim] = useState<Trim | null>(null);
  // Pixels per second: by default the typical card is about 180 px tall.
  const fit = useMemo(() => {
    const spans = items.map((it, i) => (items[i + 1] ? items[i + 1].startsAt - it.startsAt : it.playFor)).sort((a, b) => a - b);
    const median = spans[Math.floor(spans.length / 2)] || 240;
    return clampZoom(180 / median);
  }, [items]);
  const [zoom, setZoomState] = useState<number | null>(() => {
    try {
      const v = Number(localStorage.getItem(ZOOM_KEY));
      return v > 0 ? clampZoom(v) : null;
    } catch {
      return null;
    }
  });
  const pps = zoom ?? fit;
  const setZoom = (v: number | null) => {
    setZoomState(v);
    try {
      if (v) localStorage.setItem(ZOOM_KEY, String(v));
      else localStorage.removeItem(ZOOM_KEY);
    } catch {
      // private mode
    }
  };
  const playKeys = useMemo(() => {
    const m = new Map<string, string | undefined>();
    for (const s of nightSlots(items)) if ((s.semitones ?? 0) !== (s.keyShift ?? 0)) m.set(s.id, toCamelot(slotKey(s)));
    return m;
  }, [items]);
  const [prefs, setPrefs] = useListPrefs('night', { sort: 'added', desc: false, filter: {} });
  // Filtering the night dims what doesn't match: the cards stay, so the timeline stays true.
  const matches = useMemo(
    () =>
      items.map((it, i) => {
        if (!it.track) return false;
        if (!matchesFilter(it.track, prefs.filter)) return false;
        if (prefs.filter.rough) {
          const prev = items[i - 1]?.track;
          return !!prev && (!keysMix(prev.key, it.track.key) || !tempoFits(prev.bpm, it.track.bpm));
        }
        return true;
      }),
    [items, prefs.filter],
  );

  // The timeline, with a lever's drag previewed: an end drag moves everything after it too.
  const layout = useMemo<Layout>(() => {
    const starts = items.map((it) => it.startsAt);
    const ends = items.map((it) => it.startsAt + it.playFor);
    if (trim) {
      const it = items[trim.i];
      const d = snapEnd(it, clamp(trim.d, MIN_PLAY - it.playFor, maxEnd(it)));
      ends[trim.i] += d;
      if (trim.kind === 'end') for (let k = trim.i + 1; k < items.length; k++) (starts[k] += d), (ends[k] += d);
    }
    return { starts, ends };
  }, [items, trim]);
  const end = Math.max(0, ...layout.ends);

  const arrange = (how: string) => {
    const withTrack = items.map((it) => ({ id: it.entry.id, title: it.track?.title ?? '', artist: it.track?.artist ?? '', bpm: it.track?.bpm, key: it.track?.key, duration: it.playFor }));
    const order =
      how === 'harmonic' ? harmonicOrder(withTrack) : how === 'reverse' ? [...withTrack].reverse() : sortTracks(withTrack, how === 'bpmDesc' ? 'bpm' : (how as 'bpm' | 'key' | 'title'), how === 'bpmDesc');
    dispatch({ type: 'reorderEntries', ids: order.map((x) => x.id) });
    notify('The night is in its new order; each place keeps its blend.', 'info', { label: 'Undo', run: () => dispatch({ type: 'undo' }) });
  };
  /** Tonight's key: a transposition of the track (its own key stays). Without a key yet, it's the track's key. */
  const setKey = (it: TimelineItem, key: string | undefined) => {
    const t = it.track;
    if (!t) return;
    if (!t.key) return key && dispatch({ type: 'updateTrack', id: t.id, patch: { key } });
    const shift = key ? shiftToKey(t.key, key) : 0;
    if (shift === undefined) return notify(`“${key}” isn't a key Setcraft knows. Try 8A or Am.`, 'error');
    dispatch({ type: 'updateEntry', id: it.entry.id, patch: { keyShift: shift || undefined } });
    if (shift && !night.keyLockAvailable) notify(NO_STRETCH, 'error');
    else if (shift) notify(`Plays in ${toCamelot(transposeKey(t.key, shift))} tonight (${shift > 0 ? '+' : ''}${shift} semitones). Its own key stays ${toCamelot(t.key)}.`);
  };
  /** Tonight's tempo: the track plays faster or slower (its own BPM stays). Without a BPM yet, it's the track's BPM. */
  const setBpm = (it: TimelineItem, bpm: number | undefined) => {
    const t = it.track;
    if (!t) return;
    if (!t.bpm) return bpm && dispatch({ type: 'updateTrack', id: t.id, patch: { bpm, bpmConfirmed: true } });
    const same = !bpm || Math.abs(bpm - t.bpm) < 0.05;
    dispatch({ type: 'updateEntry', id: it.entry.id, patch: { playBpm: same ? undefined : bpm } });
    if (!same && !night.keyLock) notify('Key lock is off, so this track will also sound higher or lower, like a record sped up. Switch key lock on in settings to keep its key.', 'info');
  };
  const mixPoint = (it: TimelineItem, which: 'in' | 'out', at: number | undefined) => {
    if (!it.track) return;
    const { cues, patch } = setMixPoint(it.track, it.entry, which, at, set.entries);
    if (cues !== it.track.cues) dispatch({ type: 'setCues', trackId: it.track.id, cues });
    if (Object.keys(patch).length) dispatch({ type: 'updateEntry', id: it.entry.id, patch });
  };
  /** A track's end, in night time: with `keepNext`, only the blend changes. */
  const setEnd = (i: number, nightEnd: number, keepNext: boolean) => {
    const it = items[i];
    const playFor = nightEnd - it.startsAt;
    if (playFor < MIN_PLAY) return notify('The end has to come after the start.', 'error');
    dispatch({ type: 'trimEntry', id: it.entry.id, edge: 'end', to: itemMixIn(it) + playFor * itemStretch(it), keepNext });
  };
  /** A time typed on a ruler: when a track comes in (left), or when it ends (right; the next track stays put). */
  const onRulerTime = (side: 'left' | 'right', i: number, v: number | undefined) => {
    const it = items[i];
    if (v === undefined || !it) return;
    if (side === 'right') return setEnd(i, v, true);
    if (i === 0) return;
    dispatch({ type: 'setEntrance', id: it.entry.id, at: v });
    const prev = items[i - 1];
    const overlap = prev.startsAt + prev.playFor - v;
    notify(overlap > 0 ? `Comes in at ${nightTime(v)}, ${mmss(overlap)} before “${prev.track?.title}” ends.` : `Comes in at ${nightTime(v)}, ${mmss(-overlap)} after “${prev.track?.title}” ends.`);
  };

  // Where a card dragged by ☰ would land: after every card whose middle is above its own.
  const cardMid = (k: number) => ((layout.starts[k] + cardBottom(layout, k)) / 2) * pps;
  const target = drag ? items.filter((_, k) => k !== drag.idx && cardMid(k) < cardMid(drag.idx) + drag.dy).length : -1;

  return (
    <div className="m-screen m-playlist">
      {header}
      {!items.length ? (
        <div className="m-empty">
          <p className="m-empty-lead">The night is empty.</p>
          <button className="m-big-btn" onClick={onAddTracks}>
            Add tracks from the library
            <small>tap + on a track to add it to the night</small>
          </button>
        </div>
      ) : (
        <>
          <ListTools
            label="night"
            prefs={prefs}
            onPrefs={setPrefs}
            sortLabel="arrange"
            sortOptions={[
              { id: 'harmonic', label: 'mix by key' },
              { id: 'bpm', label: 'bpm ↑' },
              { id: 'bpmDesc', label: 'bpm ↓' },
              { id: 'key', label: 'key wheel' },
              { id: 'title', label: 'title' },
              { id: 'reverse', label: 'reverse' },
            ]}
            onSort={arrange}
            shown={matches.filter(Boolean).length}
            total={items.length}
            before={
              <span className="m-zoom" aria-label="zoom the timeline">
                <button className="m-edge-btn" aria-label="zoom out" onClick={() => setZoom(clampZoom(pps / 1.4))}>
                  −
                </button>
                <button className="m-edge-btn" aria-label="fit the tracks" title="fit the tracks" onClick={() => setZoom(null)}>
                  {mmss(end).replace(/^00:/, '0:')}
                </button>
                <button className="m-edge-btn" aria-label="zoom in" onClick={() => setZoom(clampZoom(pps * 1.4))}>
                  +
                </button>
              </span>
            }
            extra={
              <div className="m-tools-row">
                <button
                  className={`m-chip${prefs.filter.rough ? ' on' : ''}`}
                  aria-pressed={!!prefs.filter.rough}
                  onClick={() => setPrefs({ ...prefs, filter: { ...prefs.filter, rough: !prefs.filter.rough || undefined } })}
                  title="keys that don't mix, or more than 6% tempo, from the track before"
                >
                  rough transitions
                </button>
              </div>
            }
          />
          <div className="m-scroll m-night" ref={scroller}>
            <div className="m-timeline" style={{ height: end * pps + 40 }}>
              <Ruler side="left" items={items} layout={layout} pps={pps} end={end} startClock={set.startClock} onTime={onRulerTime} />
              <Ruler side="right" items={items} layout={layout} pps={pps} end={end} startClock={set.startClock} onTime={onRulerTime} />
              <div className="m-lanes">
                {items.map((it, i) => {
                  const top = layout.starts[i] * pps;
                  const bottom = cardBottom(layout, i) * pps;
                  const blend = i > 0 ? Math.max(0, layout.ends[i - 1] - layout.starts[i]) : 0;
                  const gap = i < items.length - 1 ? Math.max(0, layout.starts[i + 1] - layout.ends[i]) : 0;
                  const moveBy = drag ? (drag.idx === i ? drag.dy : shiftFor(i, drag.idx, target, layout, pps)) : 0;
                  return (
                    <NightCard
                      key={it.entry.id}
                      it={it}
                      i={i}
                      top={top}
                      height={Math.max(2, bottom - top)}
                      blendH={blend * pps}
                      blendSec={blend}
                      prevTitle={items[i - 1]?.track?.title}
                      prevEnd={i > 0 ? layout.ends[i - 1] : 0}
                      gapH={gap * pps}
                      gapSec={gap}
                      dimmed={!matches[i]}
                      dragging={drag?.idx === i}
                      trimming={trim?.i === i}
                      moveBy={moveBy}
                      mode={mode}
                      activeRegionId={activeRegionId}
                      loopIn={loopIn?.entryId === it.entry.id ? loopIn.s : undefined}
                      keyHint={playKeys.get(it.entry.id)}
                      menuOpen={menu === it.entry.id}
                      onMenu={(open) => setMenu(open ? it.entry.id : null)}
                      onPlay={() => {
                        setMenu(null);
                        night.play(it.startsAt);
                      }}
                      onRemove={() => {
                        setMenu(null);
                        dispatch({ type: 'removeEntry', id: it.entry.id });
                      }}
                      onKey={(k) => setKey(it, k)}
                      onBpm={(b) => setBpm(it, b)}
                      onMixPoint={(w, at) => mixPoint(it, w, at)}
                      onEndFx={(endFx) => dispatch({ type: 'updateEntry', id: it.entry.id, patch: { endFx } })}
                      onDrag={(dy) => setDrag(dy === null ? null : { idx: i, dy })}
                      onDrop={(dy) => {
                        const to = items.filter((_, k) => k !== i && cardMid(k) < cardMid(i) + dy).length;
                        setDrag(null);
                        if (to === i) return;
                        const ids = items.map((x) => x.entry.id);
                        ids.splice(to, 0, ...ids.splice(i, 1));
                        dispatch({ type: 'reorderEntries', ids });
                      }}
                    />
                  );
                })}
              </div>
              {!drag && (
                <div className="m-levers">
                  {items.map((it, i) => {
                    const overlapsNext = i < items.length - 1 && layout.ends[i] > layout.starts[i + 1] + 0.05;
                    const title = it.track?.title ?? 'track';
                    const endAt = layout.ends[i];
                    const commit = (kind: 'end' | 'blend', d: number) => {
                      setTrim(null);
                      setEnd(i, it.startsAt + it.playFor + snapEnd(it, clamp(d, MIN_PLAY - it.playFor, maxEnd(it))), kind === 'blend');
                    };
                    const tip = trim?.i === i ? <b className="m-lever-tip">ends {nightTime(endAt)}</b> : null;
                    return (
                      <span key={it.entry.id}>
                        <Lever
                          className="m-lever bottom"
                          top={cardBottom(layout, i) * pps}
                          label={`make ${title} shorter or longer`}
                          value={nightTime(endAt)}
                          pps={pps}
                          onMove={(d) => setTrim(d === null ? null : { i, kind: 'end', d })}
                          onCommit={(d) => commit('end', d)}
                          tip={trim?.kind === 'end' ? tip : null}
                        />
                        {overlapsNext && (
                          <Lever
                            className="m-lever blend"
                            top={endAt * pps}
                            label={`change how long ${title} blends into the next track`}
                            value={nightTime(endAt)}
                            pps={pps}
                            onMove={(d) => setTrim(d === null ? null : { i, kind: 'blend', d })}
                            onCommit={(d) => commit('blend', d)}
                            tip={trim?.kind === 'blend' ? tip : null}
                          />
                        )}
                      </span>
                    );
                  })}
                </div>
              )}
              <NowLine pps={pps} scroller={scroller} startClock={set.startClock} end={end} />
            </div>
            {footer}
          </div>
        </>
      )}
    </div>
  );
}

const clampZoom = (v: number) => Math.max(0.05, Math.min(4, v));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Where a card ends: when the next track comes in, or its own end when there's a gap (or it's the last). */
function cardBottom(l: Layout, k: number): number {
  return k < l.starts.length - 1 ? Math.min(l.starts[k + 1], l.ends[k]) : l.ends[k];
}

/** How much longer a track can play (night seconds): up to the end of its file. */
function maxEnd(it: TimelineItem): number {
  const r = itemStretch(it);
  const max = it.track?.duration ? (it.track.duration - itemMixIn(it)) / r : it.playFor + 600;
  return Math.max(0, max - it.playFor);
}

/** A lever's offset (night seconds) moved so the track's end lands on a beat of its grid. */
function snapEnd(it: TimelineItem, d: number): number {
  const bpm = it.track?.bpm;
  if (!bpm) return d;
  const r = itemStretch(it);
  const at = itemMixIn(it) + (it.playFor + d) * r;
  const beat = 60 / bpm;
  const g = it.track?.gridStart ?? 0;
  const snapped = g + Math.round((at - g) / beat) * beat;
  if (snapped < 0 || (it.track?.duration && snapped > it.track.duration)) return d;
  return d + (snapped - at) / r;
}

/** While a card is dragged by ☰, the cards it passes make room for it. */
function shiftFor(i: number, from: number, to: number, l: Layout, pps: number): number {
  const h = (cardBottom(l, from) - l.starts[from]) * pps;
  if (from < to && i > from && i <= to) return -h;
  if (from > to && i < from && i >= to) return h;
  return 0;
}

const NO_STRETCH =
  'Changing the key needs key lock, which this page can’t do: it needs the Mac app, or Setcraft from an https address. Over Wi-Fi from your Mac, the phone plays it in its own key.';

/** A bar to drag up or down; it reports the drag in night seconds and commits on release. */
function Lever({
  className,
  top,
  label,
  value,
  pps,
  onMove,
  onCommit,
  tip,
}: {
  className: string;
  top: number;
  label: string;
  value: string;
  pps: number;
  onMove: (d: number | null) => void;
  onCommit: (d: number) => void;
  tip: ReactNode;
}) {
  return (
    <div
      className={className}
      style={{ top }}
      role="slider"
      aria-label={label}
      aria-valuetext={value}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const y0 = e.clientY;
        const el = e.currentTarget;
        onMove(0);
        const move = (ev: PointerEvent) => onMove((ev.clientY - y0) / pps);
        const up = (ev: PointerEvent) => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
          const d = (ev.clientY - y0) / pps;
          if (ev.type !== 'pointerup' || Math.abs(d * pps) < 3) return onMove(null);
          onCommit(d);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      }}
    >
      <i />
      {tip}
    </div>
  );
}

type NightCardProps = {
  it: TimelineItem;
  i: number;
  top: number;
  height: number;
  blendH: number;
  blendSec: number;
  prevTitle?: string;
  prevEnd: number;
  gapH: number;
  gapSec: number;
  dimmed: boolean;
  dragging: boolean;
  trimming: boolean;
  moveBy: number;
  mode: StripMode;
  activeRegionId?: string;
  loopIn?: number;
  keyHint?: string;
  menuOpen: boolean;
  onMenu: (open: boolean) => void;
  onPlay: () => void;
  onRemove: () => void;
  onKey: (k: string | undefined) => void;
  onBpm: (b: number | undefined) => void;
  onMixPoint: (which: 'in' | 'out', at: number | undefined) => void;
  onEndFx: (fx: NonNullable<SetEntry['endFx']>) => void;
  onDrag: (dy: number | null) => void;
  onDrop: (dy: number) => void;
};

/**
 * One track on the timeline, from when it comes in to when the next one does.
 * The blend with the track before is a striped band at its top; a gap after it
 * is silence. Thin cards show less: a line and its waveform, then its title.
 */
function NightCard(p: NightCardProps) {
  const { it } = p;
  const t = it.track;
  const bandH = Math.min(p.height, p.blendH);
  const room = p.height - (bandH > 16 ? bandH : 0);
  const size = room >= FULL ? 'full' : room >= MID ? 'mid' : 'thin';
  const title = t?.title ?? 'Missing track';
  const start = t?.cues.find((c) => c.id === it.entry.mixInCueId)?.start ?? 0;
  const keyName = it.entry.keyShift ? transposeKey(t?.key, it.entry.keyShift) : t?.key;
  const bpm = it.entry.playBpm ?? t?.bpm;

  const handle = (
    <span
      className="m-handle"
      role="button"
      aria-label={`move ${title}`}
      title="drag to move"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const y0 = e.clientY;
        const el = e.currentTarget;
        p.onDrag(0);
        const move = (ev: PointerEvent) => p.onDrag(ev.clientY - y0);
        const up = (ev: PointerEvent) => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
          if (ev.type === 'pointerup') p.onDrop(ev.clientY - y0);
          else p.onDrag(null);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      }}
    >
      <HandleIcon />
    </span>
  );
  const more = (
    <div className="m-menu-wrap">
      <button type="button" className="m-round" aria-label={`more for ${title}`} onClick={() => p.onMenu(!p.menuOpen)}>
        <DotsIcon />
      </button>
      {p.menuOpen && (
        <>
          <div className="m-scrim" onClick={() => p.onMenu(false)} />
          <div className="m-popover m-entry-menu" role="menu">
            <button role="menuitem" onClick={p.onPlay}>
              play from here
            </button>
            <button role="menuitem" className="danger" onClick={p.onRemove}>
              remove from night
            </button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <>
      <div
        className={`m-row m-tcard size-${size}${p.dimmed ? ' dimmed' : ''}${p.dragging ? ' dragging' : ''}${p.trimming ? ' trimming' : ''}`}
        style={{ top: p.top, height: p.height, transform: p.moveBy ? `translateY(${p.moveBy}px)` : undefined }}
        data-entry={it.entry.id}
      >
        <PlayingEdge it={it} />
        {bandH > 1 && (
          <div className="m-blend-band" style={{ height: bandH }} aria-label={`blends with ${p.prevTitle ?? 'the track before'} for ${mmss(p.blendSec)}`}>
            {bandH > 12 && (
              <span>
                blend {mmss(p.blendSec).replace(/^00:/, '0:')}
                {bandH > 26 && p.prevTitle ? ` · ${p.prevTitle} ends ${nightTime(p.prevEnd)}` : ''}
              </span>
            )}
          </div>
        )}
        <div className="m-card-face" style={{ top: bandH > 16 ? bandH : 0 }}>
          {size === 'full' ? (
            <div className="m-row-body">
              <TrackCard
                title={title}
                artist={t?.artist ?? ''}
                keyName={keyName}
                keyWas={it.entry.keyShift ? toCamelot(t?.key) : undefined}
                keyHint={p.keyHint}
                bpm={bpm}
                bpmWas={it.entry.playBpm ? t?.bpm : undefined}
                start={start}
                end={t ? (t.cues.find((c) => c.id === it.entry.mixOutCueId)?.start ?? t.duration) : undefined}
                endFx={it.entry.endFx ?? t?.endFx ?? []}
                onKey={p.onKey}
                onBpm={p.onBpm}
                onStart={(s) => p.onMixPoint('in', s || undefined)}
                onEnd={(s) => p.onMixPoint('out', s !== undefined && t?.duration && s >= t.duration - 0.5 ? undefined : s)}
                onEndFx={p.onEndFx}
                left={handle}
                right={more}
              />
              <WaveStrip it={it} mode={p.mode} activeRegionId={p.activeRegionId} loopIn={p.loopIn} />
            </div>
          ) : (
            <div className="m-compact">
              {handle}
              <span className="m-c-title" title={title}>
                {title}
              </span>
              <span className="m-c-key">{toCamelot(keyName) ?? '--'}</span>
              <span className="m-c-bpm">{bpm ? Math.round(bpm * 10) / 10 : '---'}</span>
              {more}
              {size === 'mid' && (
                <div className="m-c-wave">
                  <WaveStrip it={it} mode={p.mode} activeRegionId={p.activeRegionId} loopIn={p.loopIn} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {p.gapH > 1 && (
        <div className="m-gap" style={{ top: p.top + p.height, height: p.gapH }} aria-label={`${mmss(p.gapSec)} of silence`}>
          {p.gapH > 12 && <span>silence {mmss(p.gapSec).replace(/^00:/, '0:')}</span>}
        </div>
      )}
    </>
  );
}

/** A red edge on the card playing now. */
function PlayingEdge({ it }: { it: TimelineItem }) {
  const t = useNightTime();
  return t >= it.startsAt && t < it.startsAt + it.playFor ? <div className="m-playing-edge" data-playing="true" /> : null;
}

/**
 * The timeline down one side, counting from 00:00: when each track comes in
 * (left) and ends (right), to a tenth of a second, with a tick every minute.
 * Tap a time to type it; tap anywhere else on a ruler to move the night there.
 * With a start time set, the clock time shows underneath.
 */
const Ruler = memo(function Ruler({
  side,
  items,
  layout,
  pps,
  end,
  startClock,
  onTime,
}: {
  side: 'left' | 'right';
  items: TimelineItem[];
  layout: Layout;
  pps: number;
  end: number;
  startClock?: string;
  onTime: (side: 'left' | 'right', i: number, v: number | undefined) => void;
}) {
  const night = useNight();
  const minute = 60 * pps;
  const every = minute >= 8 ? 1 : minute * 5 >= 8 ? 5 : 15;
  const ticks: number[] = [];
  for (let m = 0; m * 60 <= end + 1; m += every) ticks.push(m * 60);
  return (
    <div
      className={`m-ruler ${side}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('input')) return;
        const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
        night.seek(Math.max(0, Math.min(end, y / pps)));
      }}
    >
      {ticks.map((s) => (
        <i key={s} className={s % 300 === 0 ? 'major' : 'minor'} style={{ top: s * pps }} aria-hidden="true" />
      ))}
      {items.map((it, k) => {
        const s = side === 'left' ? layout.starts[k] : layout.ends[k];
        const title = it.track?.title ?? 'track';
        return (
          <span key={it.entry.id} className="m-ruler-label" style={{ top: s * pps }}>
            <TimeField
              className="m-ruler-time"
              label={side === 'left' ? `when ${title} comes in` : `when ${title} ends`}
              value={s}
              format={(v) => (v === undefined ? '' : nightTime(v))}
              width={s >= 3600 ? 9 : 7}
              disabled={side === 'left' && k === 0}
              onCommit={(v) => onTime(side, k, v)}
            />
            {startClock && <small>{clockLabel(s, startClock)}</small>}
          </span>
        );
      })}
    </div>
  );
});

/**
 * Where the night is: a red line across the timeline. Drag its time label to
 * move through the night. While it plays, the view follows it, until you scroll
 * away; "now" brings you back.
 */
function NowLine({ pps, scroller, startClock, end }: { pps: number; scroller: RefObject<HTMLDivElement | null>; startClock?: string; end: number }) {
  const t = useNightTime();
  const night = useNight();
  const [following, setFollowing] = useState(true);
  // Where this code last put the scroll: anything else moving it is the DJ scrolling, which stops following.
  const ourTop = useRef<number | null>(null);
  const y = t * pps;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const mine = () => ourTop.current !== null && Math.abs(el.scrollTop - ourTop.current) < 2;
    const onScroll = () => {
      if (!mine()) setFollowing(false);
    };
    const onTouch = () => setFollowing(false);
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('touchmove', onTouch, { passive: true });
    el.addEventListener('wheel', onTouch, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('touchmove', onTouch);
      el.removeEventListener('wheel', onTouch);
    };
  }, [scroller]);
  // Pressing play, or jumping somewhere (a seek, a hot cue), follows again.
  const last = useRef({ t, playing: night.playing });
  useEffect(() => {
    const was = last.current;
    if ((night.playing && !was.playing) || (Math.abs(t - was.t) > 2 && !night.isScrubbing)) setFollowing(true);
    last.current = { t, playing: night.playing };
  }, [t, night.playing, night.isScrubbing]);
  const goTo = (top: number) => {
    const el = scroller.current;
    if (!el) return;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    ourTop.current = Math.max(0, Math.min(max, top));
    el.scrollTo({ top: ourTop.current });
  };
  useEffect(() => {
    const el = scroller.current;
    if (!el || !following || !night.playing) return;
    // Scrolled by hand since the last time it followed: stop.
    if (ourTop.current !== null && Math.abs(el.scrollTop - ourTop.current) >= 2) return setFollowing(false);
    if (y < el.scrollTop + 20 || y > el.scrollTop + el.clientHeight - 60) goTo(y - el.clientHeight / 3);
    else ourTop.current = el.scrollTop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [y, following, night.playing, scroller]);

  const scrub = (e: React.PointerEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const el = e.currentTarget;
    const box = scroller.current;
    const at = (ev: PointerEvent | React.PointerEvent) => {
      const top = (box?.querySelector('.m-timeline') as HTMLElement | null)?.getBoundingClientRect().top ?? 0;
      return Math.max(0, Math.min(end, (ev.clientY - top) / pps));
    };
    night.scrubStart();
    night.scrubTo(at(e));
    const move = (ev: PointerEvent) => night.scrubTo(at(ev));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      night.scrubEnd();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const off = scroller.current && (y < scroller.current.scrollTop || y > scroller.current.scrollTop + scroller.current.clientHeight);
  return (
    <>
      <div className="m-now-line" style={{ top: y }} aria-hidden="true">
        <span className="m-now-grab" role="slider" aria-label="move the playhead" aria-valuetext={nightTime(t)} onPointerDown={scrub}>
          {nightTime(t)}
          {startClock ? ` · ${clockLabel(t, startClock)}` : ''}
        </span>
      </div>
      {!following && off && scroller.current && (
        <button
          className="m-follow"
          style={{ top: scroller.current.scrollTop + scroller.current.clientHeight - 44 }}
          onClick={() => {
            setFollowing(true);
            const el = scroller.current;
            if (el) goTo(y - el.clientHeight / 3);
          }}
        >
          ⤓ now {nightTime(t)}
        </button>
      )}
    </>
  );
}
