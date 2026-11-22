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

/**
 * The night as a true timeline: each card is as tall as its track plays, placed
 * where it starts, so blends overlap and gaps show. A red line marks where the
 * night is. Drag a card's top or bottom lever to trim its start or end; drag ☰
 * to move it; zoom with − / +.
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
  // A lever being dragged: that card's edge follows the finger until it's let go.
  const [trim, setTrim] = useState<{ i: number; edge: 'start' | 'end'; d: number } | null>(null);
  // Pixels per second: by default the typical track is about 180 px tall.
  const fit = useMemo(() => {
    const lens = items.map((it) => it.playFor).sort((a, b) => a - b);
    const median = lens[Math.floor(lens.length / 2)] || 240;
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
  const end = items.reduce((e, it) => Math.max(e, it.startsAt + it.playFor), 0);
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

  /** A time typed on a ruler: when a track comes in (left) or when it ends (right), in night time. */
  const onRulerTime = (side: 'left' | 'right', i: number, v: number | undefined) => {
    const it = items[i];
    if (v === undefined || !it) return;
    if (side === 'left') {
      if (i === 0) return;
      dispatch({ type: 'setEntrance', id: it.entry.id, at: v });
      const prev = items[i - 1];
      const overlap = prev.startsAt + prev.playFor - v;
      notify(overlap > 0 ? `Comes in at ${nightTime(v)}, ${mmss(overlap)} before “${prev.track?.title}” ends.` : `Comes in at ${nightTime(v)}, ${mmss(-overlap)} after “${prev.track?.title}” ends.`);
    } else {
      const playFor = v - it.startsAt;
      if (playFor < MIN_PLAY) return notify('The end has to come after the start.', 'error');
      dispatch({ type: 'trimEntry', id: it.entry.id, edge: 'end', to: itemMixIn(it) + playFor * itemStretch(it) });
    }
  };

  // Each card's place: as tall as it plays; what the next card covers is its blend.
  const geo = useMemo(() => {
    const g = items.map((it, i) => {
      const lim = trimLimits(it);
      const topD = trim?.i === i && trim.edge === 'start' ? snapD(it, 'start', clamp(trim.d, lim.minTop, lim.maxTop)) : 0;
      const endD = trim?.i === i && trim.edge === 'end' ? snapD(it, 'end', clamp(trim.d, lim.minEnd, lim.maxEnd)) : 0;
      return { top: (it.startsAt + topD) * pps, height: Math.max(2, (it.playFor - topD + endD) * pps), topD, endD, visible: 0 };
    });
    g.forEach((x, i) => {
      const next = g[i + 1];
      x.visible = next && next.top < x.top + x.height ? Math.max(0, next.top - x.top) : x.height;
    });
    return g;
  }, [items, pps, trim]);

  // Where a card dragged by ☰ would land: after every card whose middle is above its own.
  const target = useMemo(() => {
    if (!drag) return -1;
    const it = items[drag.idx];
    const mid = (it.startsAt + it.playFor / 2) * pps + drag.dy;
    return items.filter((x, i) => i !== drag.idx && (x.startsAt + x.playFor / 2) * pps < mid).length;
  }, [drag, items, pps]);

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
              <Ruler side="left" items={items} pps={pps} end={end} startClock={set.startClock} onTime={onRulerTime} />
              <Ruler side="right" items={items} pps={pps} end={end} startClock={set.startClock} onTime={onRulerTime} />
              <div className="m-lanes">
                {items.map((it, i) => {
                  const moveBy = drag ? (drag.idx === i ? drag.dy : shiftFor(i, drag.idx, target, items, pps)) : 0;
                  return (
                    <NightCard
                      key={it.entry.id}
                      it={it}
                      i={i}
                      geo={geo[i]}
                      lane={i % 2}
                      trimming={trim?.i === i}
                      dimmed={!matches[i]}
                      dragging={drag?.idx === i}
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
                        const it0 = items[i];
                        const mid = (it0.startsAt + it0.playFor / 2) * pps + dy;
                        const to = items.filter((x, k) => k !== i && (x.startsAt + x.playFor / 2) * pps < mid).length;
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
              <div className="m-levers">
                {items.map((it, i) => (
                  <Levers
                    key={it.entry.id}
                    it={it}
                    geo={geo[i]}
                    lane={i % 2}
                    covered={geo[i].visible < geo[i].height - 1}
                    pps={pps}
                    hidden={!!drag}
                    trim={trim?.i === i ? trim : null}
                    onTrim={(edge, d) => setTrim(d === null ? null : { i, edge, d })}
                    onCommit={(edge, d) => {
                      setTrim(null);
                      const lim = trimLimits(it);
                      const mixIn = itemMixIn(it);
                      const r = itemStretch(it);
                      if (edge === 'start') dispatch({ type: 'trimEntry', id: it.entry.id, edge, to: mixIn + snapD(it, 'start', clamp(d, lim.minTop, lim.maxTop)) * r });
                      else dispatch({ type: 'trimEntry', id: it.entry.id, edge, to: mixIn + (it.playFor + snapD(it, 'end', clamp(d, lim.minEnd, lim.maxEnd))) * r });
                    }}
                  />
                ))}
              </div>
              <NowLine pps={pps} scroller={scroller} startClock={set.startClock} />
            </div>
            {footer}
          </div>
        </>
      )}
    </div>
  );
}

const clampZoom = (v: number) => Math.max(0.05, Math.min(4, v));

/** How far (night seconds) a card's start and end can be dragged: not before the top of the file, not past its end, never shorter than MIN_PLAY. */
function trimLimits(it: TimelineItem) {
  const r = itemStretch(it);
  const mixIn = itemMixIn(it);
  const maxPlay = it.track?.duration ? (it.track.duration - mixIn) / r : it.playFor + 600;
  return { minTop: -mixIn / r, maxTop: it.playFor - MIN_PLAY, minEnd: MIN_PLAY - it.playFor, maxEnd: Math.max(0, maxPlay - it.playFor) };
}

type Geo = { top: number; height: number; topD: number; endD: number; visible: number };

/** A lever's offset (night seconds) moved so the edge lands on a beat. */
function snapD(it: TimelineItem, edge: 'start' | 'end', d: number): number {
  const r = itemStretch(it);
  const mixIn = itemMixIn(it);
  const edgeAt = edge === 'start' ? mixIn + d * r : mixIn + (it.playFor + d) * r;
  const snapped = onBeat(it, edgeAt);
  const max = it.track?.duration;
  if (snapped < 0 || (max && snapped > max)) return d;
  return d + (snapped - edgeAt) / r;
}

/** A song time on the nearest beat of the track's grid (when it has a BPM), so a trim always lands on the beat. */
function onBeat(it: TimelineItem, s: number): number {
  const bpm = it.track?.bpm;
  if (!bpm) return s;
  const beat = 60 / bpm;
  const g = it.track?.gridStart ?? 0;
  return Math.max(0, g + Math.round((s - g) / beat) * beat);
}

/** A card's two levers: grab the top to trim where it starts, the bottom to trim where it ends. Above every card, so a blend never hides them. */
function Levers({
  it,
  geo,
  lane,
  covered,
  pps,
  hidden,
  trim,
  onTrim,
  onCommit,
}: {
  it: TimelineItem;
  geo: Geo;
  lane: number;
  covered: boolean;
  pps: number;
  hidden: boolean;
  trim: { edge: 'start' | 'end'; d: number } | null;
  onTrim: (edge: 'start' | 'end', d: number | null) => void;
  onCommit: (edge: 'start' | 'end', d: number) => void;
}) {
  if (hidden) return null;
  const title = it.track?.title ?? 'track';
  const mixIn = itemMixIn(it);
  const r = itemStretch(it);
  const grab = (edge: 'start' | 'end') => (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const y0 = e.clientY;
    const el = e.currentTarget;
    onTrim(edge, 0);
    const move = (ev: PointerEvent) => onTrim(edge, (ev.clientY - y0) / pps);
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      const d = (ev.clientY - y0) / pps;
      if (ev.type !== 'pointerup' || Math.abs(d * pps) < 3) return onTrim(edge, null);
      onCommit(edge, d);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  const side = lane === 0 ? 'lane-0' : 'lane-1';
  return (
    <>
      <div
        className={`m-lever top ${side}`}
        style={{ top: geo.top }}
        role="slider"
        aria-label={`trim the start of ${title}`}
        aria-valuetext={mmss(mixIn + geo.topD * r)}
        onPointerDown={grab('start')}
      >
        <i />
        {trim?.edge === 'start' && <b className="m-lever-tip">start {mmss(mixIn + geo.topD * r)}</b>}
      </div>
      <div
        className={`m-lever bottom ${side}${covered ? ' covered' : ''}`}
        style={{ top: geo.top + geo.height }}
        role="slider"
        aria-label={`trim the end of ${title}`}
        aria-valuetext={mmss(mixIn + (it.playFor + geo.endD) * r)}
        onPointerDown={grab('end')}
      >
        <i />
        {trim?.edge === 'end' && <b className="m-lever-tip">end {mmss(mixIn + (it.playFor + geo.endD) * r)}</b>}
      </div>
    </>
  );
}

/** While a card is dragged by ☰, the cards it passes make room for it. */
function shiftFor(i: number, from: number, to: number, items: TimelineItem[], pps: number): number {
  const h = items[from].playFor * pps;
  if (from < to && i > from && i <= to) return -h;
  if (from > to && i < from && i >= to) return h;
  return 0;
}

const NO_STRETCH =
  'Changing the key needs key lock, which this page can’t do: it needs the Mac app, or Setcraft from an https address. Over Wi-Fi from your Mac, the phone plays it in its own key.';

type NightCardProps = {
  it: TimelineItem;
  i: number;
  geo: Geo;
  lane: number;
  trimming: boolean;
  dimmed: boolean;
  dragging: boolean;
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
 * One track on the timeline, as tall as it plays. Its details sit in the part
 * the next track doesn't cover; the covered tail is its blend. Thin cards show
 * less: a line and the waveform, then just the title.
 */
function NightCard(p: NightCardProps) {
  const { it, geo } = p;
  const t = it.track;
  const size = geo.visible >= FULL ? 'full' : geo.visible >= MID ? 'mid' : 'thin';
  const title = t?.title ?? 'Missing track';
  const start = t?.cues.find((c) => c.id === it.entry.mixInCueId)?.start ?? 0;
  const blendH = geo.height - geo.visible;

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
  const keyName = it.entry.keyShift ? transposeKey(t?.key, it.entry.keyShift) : t?.key;
  const bpm = it.entry.playBpm ?? t?.bpm;

  return (
    <div
      className={`m-row m-tcard size-${size} lane-${p.lane}${p.dimmed ? ' dimmed' : ''}${p.dragging ? ' dragging' : ''}${p.trimming ? ' trimming' : ''}`}
      style={{ top: geo.top, height: geo.height, zIndex: p.dragging || p.trimming ? 50 : p.i + 1, transform: p.moveBy ? `translateY(${p.moveBy}px)` : undefined }}
      data-entry={it.entry.id}
    >
      <PlayingEdge it={it} />
      <div className="m-card-face" style={{ height: geo.visible }}>
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
      {blendH > 1 && (
        <div className="m-blend-tail" style={{ top: geo.visible, height: blendH }} title={`blends into the next track over ${mmss(blendH / (geo.height / it.playFor))}`}>
          {blendH > 24 && <i>{mmss(blendH / (geo.height / Math.max(1, it.playFor - geo.topD + geo.endD))).replace(/^00:/, '0:')}</i>}
        </div>
      )}
    </div>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A red edge on the card playing now. */
function PlayingEdge({ it }: { it: TimelineItem }) {
  const t = useNightTime();
  return t >= it.startsAt && t < it.startsAt + it.playFor ? <div className="m-playing-edge" data-playing="true" /> : null;
}

/**
 * The timeline down one side, counting from 00:00: when each track comes in
 * (left) and ends (right), to a tenth of a second, with a tick every minute.
 * Tap a time to type it: a track's entrance, or its end. With a start time set,
 * the clock time shows underneath.
 */
const Ruler = memo(function Ruler({
  side,
  items,
  pps,
  end,
  startClock,
  onTime,
}: {
  side: 'left' | 'right';
  items: TimelineItem[];
  pps: number;
  end: number;
  startClock?: string;
  onTime: (side: 'left' | 'right', i: number, v: number | undefined) => void;
}) {
  const minute = 60 * pps;
  const every = minute >= 8 ? 1 : minute * 5 >= 8 ? 5 : 15;
  const ticks: number[] = [];
  for (let m = 0; m * 60 <= end + 1; m += every) ticks.push(m * 60);
  return (
    <div className={`m-ruler ${side}`}>
      {ticks.map((s) => (
        <i key={s} className={s % 300 === 0 ? 'major' : 'minor'} style={{ top: s * pps }} aria-hidden="true" />
      ))}
      {items.map((it, k) => {
        const s = side === 'left' ? it.startsAt : it.startsAt + it.playFor;
        const title = it.track?.title ?? 'track';
        return (
          <span key={it.entry.id} className="m-ruler-label" style={{ top: s * pps }}>
            <TimeField
              className="m-ruler-time"
              label={side === 'left' ? `when ${title} comes in` : `when ${title} ends`}
              value={s}
              format={(v) => (v === undefined ? '' : nightTime(v))}
              width={side === 'left' && s >= 3600 ? 9 : 7}
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

/** Where the night is: a red line across the timeline, followed while it plays (unless you've just scrolled). */
function NowLine({ pps, scroller, startClock }: { pps: number; scroller: RefObject<HTMLDivElement | null>; startClock?: string }) {
  const t = useNightTime();
  const night = useNight();
  const touched = useRef(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const mark = () => (touched.current = Date.now());
    el.addEventListener('touchstart', mark, { passive: true });
    el.addEventListener('wheel', mark, { passive: true });
    return () => {
      el.removeEventListener('touchstart', mark);
      el.removeEventListener('wheel', mark);
    };
  }, [scroller]);
  const y = t * pps;
  useEffect(() => {
    const el = scroller.current;
    if (!el || !night.playing || Date.now() - touched.current < 4000) return;
    if (y < el.scrollTop + 20 || y > el.scrollTop + el.clientHeight - 60) el.scrollTo({ top: Math.max(0, y - el.clientHeight / 3) });
  }, [y, night.playing, scroller]);
  return (
    <div className="m-now-line" style={{ top: y }} aria-label={`now: ${nightTime(t)}`}>
      <span>
        {nightTime(t)}
        {startClock ? ` · ${clockLabel(t, startClock)}` : ''}
      </span>
    </div>
  );
}
