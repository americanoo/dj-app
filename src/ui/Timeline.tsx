import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { keyColor, toCamelot, type KeyRelation } from '../core/keys';
import { SLOT_LETTERS, type SetEntry } from '../core/model';
import { buildTimeline, formatSetTime, nightAtTrack, parseClock, totalSeconds, trackAtNight, type TimelineItem } from '../core/setplan';
import { transport } from './transport';
import { formatTime, parseTime } from '../core/time';
import { activeSet, useStore } from './store';
import { useFitZoom, zoomOf } from './fit';

/** Drag payload type for library rows. */
export const TRACK_DRAG_TYPE = 'application/x-setcraft-track';

// Lanes stretch with the panel's height, between these limits.
const MIN_LANE_H = 24;
const MAX_LANE_H = 64;
const RULER_H = 22;
const CHAPTER_H = 18;
const ENERGY_H = 34;
const SMALL_ENERGY_H = 20;
/** Smallest the lanes area can be before the panel is scaled down instead. */
const MIN_CANVAS_H = RULER_H + CHAPTER_H + SMALL_ENERGY_H + MIN_LANE_H * 2 + 12;
const MAGNET_PX = 10;
const MAX_PX_PER_SEC = 40; // zoomed all the way in: seconds are easy to hit
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

const RELATION_COLOR: Record<KeyRelation, string> = {
  same: 'var(--ok)',
  adjacent: 'var(--ok)',
  relative: 'var(--ok)',
  diagonal: 'var(--ok)',
  boost: 'var(--warn)',
  clash: 'var(--danger)',
  unknown: 'var(--muted)',
};

interface Props {
  selectedTrackId: string | null;
  onSelectTrack: (trackId: string) => void;
  onOpenStory: () => void;
}

export function Timeline({ selectedTrackId, onSelectTrack, onOpenStory }: Props) {
  const { project, dispatch } = useStore();
  const set = activeSet(project);
  const items = useMemo(() => buildTimeline(set, project.library), [set, project.library]);
  const end = totalSeconds(items);
  const length = Math.max(set.targetMinutes * 60, end + 300, 600);

  const scroller = useRef<HTMLDivElement>(null);
  const [viewWidth, setViewWidth] = useState(800);
  const [viewHeight, setViewHeight] = useState(200);
  const fitRef = useFitZoom<HTMLDivElement>(0.5);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const fitPx = Math.max(0.02, (viewWidth - 24) / length);
  const pxps = zoom === 'fit' ? fitPx : zoom;
  const anchor = useRef<{ t: number; x: number } | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; startX: number; origAt: number; active: boolean } | null>(null);
  const [ghost, setGhost] = useState<number | null>(null);

  const selected = items.find((it) => it.entry.id === selectedId);

  // Night playhead: follows the deck every frame, outside React.
  const playheadEl = useRef<HTMLDivElement>(null);
  const nowEl = useRef<HTMLSpanElement>(null);
  const nightT = useRef<number | null>(null);
  const live = useRef({ items, pxps: 1, startClock: set.startClock });
  const place = useCallback(() => {
    const { pxps: px, startClock } = live.current;
    const t = nightT.current;
    const el = playheadEl.current;
    if (el) {
      el.style.display = t === null ? 'none' : '';
      if (t !== null) el.style.transform = `translateX(${t * px}px)`;
    }
    if (nowEl.current) nowEl.current.textContent = t === null ? '' : `▶ ${formatSetTime(Math.max(0, t), startClock, true)}`;
  }, []);
  // Scrubbing the night: click or drag the background (not a track block).
  const scrub = useRef<{
    wasPlaying: boolean;
    held: boolean;
    moved: boolean;
    last: { trackId: string; pos: number };
    ghost: boolean;
  } | null>(null);
  useEffect(
    () =>
      transport.onPosition((p) => {
        if (scrub.current?.ghost) return; // the line follows the pointer until it's let go
        nightT.current = p ? (nightAtTrack(live.current.items, p.trackId, p.pos) ?? null) : null;
        place();
      }),
    [place],
  );

  // Fill the panel's height: the energy line slims down on short panels and the lanes take the rest.
  const energyH = viewHeight >= 170 ? ENERGY_H : SMALL_ENERGY_H;
  const laneH = Math.max(
    MIN_LANE_H,
    Math.min(MAX_LANE_H, Math.floor((viewHeight - RULER_H - CHAPTER_H - energyH - 12) / 2)),
  );

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setViewWidth(el.clientWidth);
      setViewHeight(el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ⌘/Ctrl + wheel zooms. Native listener: React's wheel handlers are passive
  // and couldn't stop the browser from zooming the page instead.
  const zoomRef = useRef<(f: number, x: number) => void>(() => undefined);
  zoomRef.current = (factor, x) => zoomTo(pxps * factor, x);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomRef.current(e.deltaY < 0 ? 1.25 : 0.8, e.clientX);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Keep the moment under the cursor in place while zooming.
  useLayoutEffect(() => {
    const a = anchor.current;
    if (a && scroller.current) scroller.current.scrollLeft = a.t * pxps - a.x;
    anchor.current = null;
  }, [pxps]);

  const zoomTo = (next: number, aroundClientX?: number) => {
    const el = scroller.current;
    const clamped = Math.min(MAX_PX_PER_SEC, Math.max(fitPx, next));
    if (el) {
      const rect = el.getBoundingClientRect();
      const x = ((aroundClientX ?? rect.left + rect.width / 2) - rect.left) / zoomOf(el);
      anchor.current = { t: (el.scrollLeft + x) / pxps, x };
    }
    setZoom(clamped <= fitPx * 1.001 ? 'fit' : clamped);
  };

  const timeAt = (clientX: number) => {
    // Measured from the canvas itself (it sits inside a margin and scrolls with the view).
    const canvas = scroller.current!.querySelector<HTMLElement>('.timeline-canvas')!;
    return Math.max(0, (clientX - canvas.getBoundingClientRect().left) / zoomOf(canvas) / pxps);
  };

  /** Whole seconds, pulled onto a neighbouring track's start or end when close. */
  const snap = useCallback(
    (t: number, ignoreId?: string, free = false) => {
      const edges = items
        .filter((it) => it.entry.id !== ignoreId)
        .flatMap((it) => [it.startsAt, it.startsAt + it.playFor]);
      let best = t;
      let bestPx = MAGNET_PX;
      for (const e of edges) {
        const d = Math.abs(e - t) * pxps;
        if (d < bestPx) {
          best = e;
          bestPx = d;
        }
      }
      if (best !== t) return Math.max(0, best);
      return Math.max(0, free ? Math.round(t * 1000) / 1000 : Math.round(t));
    },
    [items, pxps],
  );

  // Delete / Backspace removes the selected track from the night.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
      e.preventDefault();
      dispatch({ type: 'removeEntry', id: selectedId });
      setSelectedId(null);
    }
  };

  const tickStep = TICK_STEPS.find((s) => s * pxps >= 70) ?? 3600;
  const ticks: number[] = [];
  for (let t = 0; t <= length; t += tickStep) ticks.push(t);

  // Contiguous chapter bands.
  const bands: { id: string; name: string; color: string; from: number; to: number }[] = [];
  for (const it of items) {
    const ch = set.chapters.find((c) => c.id === it.entry.chapterId);
    const last = bands[bands.length - 1];
    if (last && last.id === it.entry.chapterId) last.to = Math.max(last.to, it.startsAt + it.playFor);
    else bands.push({ id: it.entry.chapterId, name: ch?.name ?? '', color: ch?.color ?? '#888', from: it.startsAt, to: it.startsAt + it.playFor });
  }

  const energyPoints = items
    .map((it) => `${(it.startsAt + it.playFor / 2) * pxps},${energyH - 4 - ((it.entry.energy - 1) / 9) * (energyH - 8)}`)
    .join(' ');

  const width = Math.max(viewWidth, length * pxps + 24);
  const lanesTop = RULER_H + CHAPTER_H + energyH;
  live.current = { items, pxps, startClock: set.startClock };
  useLayoutEffect(() => {
    const p = transport.position;
    if (!scrub.current?.ghost) nightT.current = p ? (nightAtTrack(items, p.trackId, p.pos) ?? null) : null;
    place();
  });

  return (
    <div className="timeline-pane" ref={fitRef} data-keys-own onKeyDown={onKeyDown} tabIndex={-1}>
      <div className="pane-head">
        <h3>Journey of the night</h3>
        <span className="muted small-text">
          {items.length} tracks · {formatTime(end, false)} of {set.targetMinutes} min
          {parseClock(set.startClock) !== undefined
            ? ` · ${set.startClock}–${formatSetTime(end, set.startClock)}`
            : ''}
        </span>
        <span className="tl-now" ref={nowEl} title="Where the deck is in the night. Click or drag the timeline to jump." />
        <button className="small" onClick={onOpenStory} title="Story, venue, start time and chapters">
          Story &amp; chapters
        </button>
        <span className="grow" />
        <span className="muted small-text">Drag tracks from the library onto the timeline · ⌘/Ctrl + scroll to zoom</span>
        <div className="zoom-controls">
          <button className="icon" onClick={() => zoomTo(pxps / 2)} title="Zoom out">
            −
          </button>
          <button className="small" onClick={() => setZoom('fit')} disabled={zoom === 'fit'} title="Show the whole night">
            Fit
          </button>
          <button className="icon" onClick={() => zoomTo(pxps * 2)} title="Zoom in (down to seconds)">
            +
          </button>
        </div>
      </div>

      <div
        ref={scroller}
        className="timeline-scroll"
        style={{ minHeight: MIN_CANVAS_H + 4 }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(TRACK_DRAG_TYPE)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setGhost(snap(timeAt(e.clientX), undefined, e.shiftKey));
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setGhost(null);
        }}
        onDrop={(e) => {
          const trackId = e.dataTransfer.getData(TRACK_DRAG_TYPE);
          setGhost(null);
          if (!trackId) return;
          e.preventDefault();
          dispatch({ type: 'placeTrack', trackId, at: snap(timeAt(e.clientX), undefined, e.shiftKey) });
          onSelectTrack(trackId);
        }}
        onPointerDown={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest('.tl-block, button, input, select')) return;
          if (e.target === e.currentTarget || target.classList.contains('tl-lanes')) setSelectedId(null);
          if (e.button !== 0) return;
          const at = trackAtNight(items, timeAt(e.clientX));
          if (!at) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          scrub.current = { wasPlaying: !!transport.position?.playing, held: false, moved: false, last: at, ghost: false };
        }}
        onPointerMove={(e) => {
          const sc = scrub.current;
          if (!sc) return;
          const t = timeAt(e.clientX);
          const at = trackAtNight(items, t);
          if (!at) return;
          sc.moved = true;
          sc.last = at;
          if (at.trackId === transport.position?.trackId) {
            // The deck's own track: scrub it live, holding the audio.
            if (!sc.held) {
              transport.request({ type: 'scrubStart' });
              sc.held = true;
            }
            sc.ghost = false;
            transport.request({ type: 'seek', trackId: at.trackId, pos: at.pos });
          } else {
            // Another track: show where it'll land; it loads on release.
            sc.ghost = true;
            nightT.current = t;
            place();
          }
        }}
        onPointerUp={() => {
          const sc = scrub.current;
          scrub.current = null;
          if (!sc) return;
          const { trackId, pos } = sc.last;
          if (trackId === transport.position?.trackId) {
            if (!sc.moved) transport.request({ type: 'seek', trackId, pos });
            if (sc.held) transport.request({ type: 'scrubEnd' });
          } else {
            // Loading another track replaces the held one, so no need to let go of it first.
            transport.request({ type: 'seek', trackId, pos, play: sc.wasPlaying });
          }
        }}
        onPointerCancel={() => {
          if (scrub.current?.held) transport.request({ type: 'scrubEnd' });
          scrub.current = null;
        }}
      >
        <div className="timeline-canvas" style={{ width, height: lanesTop + laneH * 2 + 8 }}>
          <div className="tl-playhead" ref={playheadEl} aria-hidden />
          <div className="tl-ruler" style={{ height: RULER_H }}>
            {ticks.map((t) => (
              <span key={t} className="tl-tick" style={{ left: t * pxps }}>
                {formatSetTime(t, set.startClock, tickStep < 60)}
              </span>
            ))}
          </div>
          <div className="tl-chapters" style={{ top: RULER_H, height: CHAPTER_H }}>
            {bands.map((b, i) => (
              <span
                key={i}
                className="tl-band"
                style={{ left: b.from * pxps, width: Math.max(2, (b.to - b.from) * pxps), background: b.color }}
                title={b.name}
              >
                {b.name}
              </span>
            ))}
          </div>
          <svg className="tl-energy" style={{ top: RULER_H + CHAPTER_H, height: energyH }} width={width} height={energyH}>
            {items.length > 1 && <polyline points={energyPoints} />}
            {items.map((it) => (
              <circle
                key={it.entry.id}
                cx={(it.startsAt + it.playFor / 2) * pxps}
                cy={energyH - 4 - ((it.entry.energy - 1) / 9) * (energyH - 8)}
                r={3}
              >
                <title>Energy {it.entry.energy}/10</title>
              </circle>
            ))}
          </svg>
          <div className="tl-lanes" style={{ top: lanesTop, height: laneH * 2 + 4 }}>
            {items.map((it, i) => (
              <TrackBlock
                key={it.entry.id}
                item={it}
                lane={i % 2}
                laneH={laneH}
                pxps={pxps}
                selected={it.entry.id === selectedId}
                loaded={it.entry.trackId === selectedTrackId}
                chapterColor={set.chapters.find((c) => c.id === it.entry.chapterId)?.color ?? '#888'}
                startClock={set.startClock}
                dragging={drag?.id === it.entry.id && drag.active}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  setSelectedId(it.entry.id);
                  onSelectTrack(it.entry.trackId);
                  setDrag({ id: it.entry.id, startX: e.clientX, origAt: it.startsAt, active: false });
                }}
                onPointerMove={(e) => {
                  if (!drag || drag.id !== it.entry.id) return;
                  const dx = (e.clientX - drag.startX) / zoomOf(e.currentTarget as HTMLElement);
                  if (!drag.active && Math.abs(dx) < 4) return;
                  if (!drag.active) setDrag({ ...drag, active: true });
                  dispatch({ type: 'setEntryTime', id: it.entry.id, at: snap(drag.origAt + dx / pxps, it.entry.id, e.shiftKey) });
                }}
                onPointerUp={() => setDrag(null)}
              />
            ))}
            {ghost !== null && (
              <div className="tl-ghost" style={{ left: ghost * pxps }}>
                <span>{formatSetTime(ghost, set.startClock, true)}</span>
              </div>
            )}
          </div>
          <div className="tl-target" style={{ left: set.targetMinutes * 60 * pxps, top: RULER_H }} title="Target length" />
          {!items.length && (
            <div className="tl-empty" style={{ top: lanesTop + 12 }}>
              Drag tracks here from the library below, or use <b>+ Set</b> on a row.
            </div>
          )}
        </div>
      </div>

      {selected && <EntryInspector item={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function TrackBlock(props: {
  item: TimelineItem;
  lane: number;
  laneH: number;
  pxps: number;
  selected: boolean;
  loaded: boolean;
  chapterColor: string;
  startClock?: string;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
}) {
  const { item, pxps } = props;
  const t = item.track;
  const w = Math.max(6, item.playFor * pxps);
  const kc = keyColor(t?.key);
  return (
    <div
      className={`tl-block ${props.selected ? 'selected' : ''} ${props.loaded ? 'loaded' : ''} ${props.dragging ? 'dragging' : ''} ${
        props.laneH < 38 ? 'compact' : ''
      }`}
      style={{ left: item.startsAt * pxps, width: w, top: props.lane * (props.laneH + 4), height: props.laneH, borderLeftColor: props.chapterColor }}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      title={`${t ? `${t.artist} – ${t.title}` : 'Missing track'}\n${formatSetTime(item.startsAt, props.startClock, true)} → ${formatSetTime(
        item.startsAt + item.playFor,
        props.startClock,
        true,
      )}${item.warnings.length ? '\n⚠ ' + item.warnings.join('\n⚠ ') : ''}`}
    >
      {item.gap < 0 || item.keyRelation !== 'unknown' ? (
        <i className="tl-rel" style={{ background: item.warnings.length ? 'var(--danger)' : RELATION_COLOR[item.keyRelation] }} />
      ) : null}
      {w > 40 && (
        <>
          <span className="tl-title">{t ? t.title : 'Missing track'}</span>
          <span className="tl-meta">
            {formatSetTime(item.startsAt, props.startClock, true)}
            {t?.bpm ? ` · ${t.bpm.toFixed(0)}` : ''}
            {t?.key && (
              <b className="key-pill" style={{ background: kc }}>
                {toCamelot(t.key)}
              </b>
            )}
          </span>
        </>
      )}
    </div>
  );
}

function EntryInspector({ item, onClose }: { item: TimelineItem; onClose: () => void }) {
  const { project, dispatch } = useStore();
  const set = activeSet(project);
  const { entry, track } = item;
  const update = (patch: Partial<SetEntry>) => dispatch({ type: 'updateEntry', id: entry.id, patch });
  const [startText, setStartText] = useState(formatTime(item.startsAt));
  useEffect(() => setStartText(formatTime(item.startsAt)), [item.startsAt]);
  const cues = track ? [...track.cues].sort((a, b) => a.start - b.start) : [];
  const cueLabel = (id: string) => {
    const c = track?.cues.find((x) => x.id === id);
    return c ? `${c.slot !== null ? SLOT_LETTERS[c.slot] : 'Mem'} ${formatTime(c.start, false)}${c.name ? ' ' + c.name : ''}` : '';
  };

  return (
    <div className="tl-inspector">
      <b className="tl-insp-title">{track ? `${track.artist} – ${track.title}` : 'Missing track'}</b>
      <label className="inline" title="Start, from the beginning of the set (h:mm:ss)">
        Starts
        <input
          className="time-input"
          value={startText}
          onChange={(e) => setStartText(e.target.value)}
          onBlur={() => {
            const t = parseTime(startText);
            if (t !== undefined) dispatch({ type: 'setEntryTime', id: entry.id, at: t });
            else setStartText(formatTime(item.startsAt));
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        {parseClock(set.startClock) !== undefined && <span className="muted">{formatSetTime(item.startsAt, set.startClock, true)}</span>}
      </label>
      <select value={entry.chapterId} onChange={(e) => update({ chapterId: e.target.value })} aria-label="Chapter">
        {set.chapters.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <label className="inline energy" title="Planned energy">
        Energy
        <input type="range" min={1} max={10} value={entry.energy} onChange={(e) => update({ energy: Number(e.target.value) })} />
        <span className="energy-val">{entry.energy}</span>
      </label>
      <input
        className="grow"
        value={entry.transition}
        placeholder="Transition in: e.g. 32-bar blend, bass swap"
        onChange={(e) => update({ transition: e.target.value })}
      />
      <input className="grow" value={entry.notes} placeholder="Notes / moment" onChange={(e) => update({ notes: e.target.value })} />
      <select value={entry.mixInCueId ?? ''} onChange={(e) => update({ mixInCueId: e.target.value || undefined })} title="Mix-in cue">
        <option value="">In: start</option>
        {cues.map((c) => (
          <option key={c.id} value={c.id}>
            In: {cueLabel(c.id)}
          </option>
        ))}
      </select>
      <select value={entry.mixOutCueId ?? ''} onChange={(e) => update({ mixOutCueId: e.target.value || undefined })} title="Mix-out cue">
        <option value="">Out: end</option>
        {cues.map((c) => (
          <option key={c.id} value={c.id}>
            Out: {cueLabel(c.id)}
          </option>
        ))}
      </select>
      {item.warnings.map((w) => (
        <span key={w} className="warn small-text">
          ⚠ {w}
        </span>
      ))}
      <button className="small danger" onClick={() => dispatch({ type: 'removeEntry', id: entry.id })}>
        Remove
      </button>
      <button className="icon" onClick={onClose} title="Close">
        ×
      </button>
    </div>
  );
}
