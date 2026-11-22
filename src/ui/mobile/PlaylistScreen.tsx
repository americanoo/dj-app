import { memo, useMemo, useState, type ReactNode } from 'react';
import type { SetEntry } from '../../core/model';
import { nightSlots, slotKey, type TimelineItem } from '../../core/setplan';
import { setMixPoint } from '../../core/sheet';
import { shiftToKey, toCamelot, transposeKey } from '../../core/keys';
import { harmonicOrder, keysMix, matchesFilter, sortTracks, tempoFits } from '../../core/listsort';
import { notify } from '../toastBus';
import { ListTools, useListPrefs } from './ListTools';
import { useNight } from '../night';
import { activeSet, useStore } from '../store';
import { DotsIcon, HandleIcon } from './icons';
import { clockLabel, itemIndexAt, useNightTime } from './nightModel';
import { TrackCard } from './TrackCard';
import { WaveStrip, type StripMode } from './WaveStrip';

/** One row of the night: a card and its waveform. Rows are evenly spaced; the rulers give their real times. */
const ROW = 124;

/**
 * The night: the tracks in order, each with its waveform, between two clock
 * rulers showing when each one starts. The track playing now is marked in red.
 * Drag a card by its handle to move it.
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
  const [drag, setDrag] = useState<{ idx: number; dy: number } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const playKeys = useMemo(() => {
    const m = new Map<string, string | undefined>();
    for (const s of nightSlots(items)) if ((s.semitones ?? 0) !== (s.keyShift ?? 0)) m.set(s.id, toCamelot(slotKey(s)));
    return m;
  }, [items]);
  const end = items.reduce((e, it) => Math.max(e, it.startsAt + it.playFor), 0);
  const [prefs, setPrefs] = useListPrefs('night', { sort: 'added', desc: false, filter: {} });
  // Filtering the night dims what doesn't match: the rows stay, so the clock stays true.
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
  const target = drag ? Math.max(0, Math.min(items.length - 1, drag.idx + Math.round(drag.dy / ROW))) : -1;

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

  const shift = (i: number) => {
    if (!drag || i === drag.idx) return 0;
    if (drag.idx < target && i > drag.idx && i <= target) return -ROW;
    if (drag.idx > target && i < drag.idx && i >= target) return ROW;
    return 0;
  };

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
        <div className="m-scroll m-night" style={{ ['--row' as string]: `${ROW}px` }}>
          {items.map((it, i) => (
            <div
              key={it.entry.id}
              className={`m-row${drag?.idx === i ? ' dragging' : ''}${matches[i] ? '' : ' dimmed'}`}
              style={drag ? { transform: `translateY(${drag.idx === i ? drag.dy : shift(i)}px)` } : undefined}
            >
              <Ruler side="left" i={i} items={items} label={clockLabel(it.startsAt, set.startClock)} />
              <div className="m-row-body">
                <TrackCard
                  title={it.track?.title ?? 'Missing track'}
                  artist={it.track?.artist ?? ''}
                  keyName={it.entry.keyShift ? transposeKey(it.track?.key, it.entry.keyShift) : it.track?.key}
                  keyWas={it.entry.keyShift ? toCamelot(it.track?.key) : undefined}
                  keyHint={playKeys.get(it.entry.id)}
                  bpm={it.entry.playBpm ?? it.track?.bpm}
                  bpmWas={it.entry.playBpm ? it.track?.bpm : undefined}
                  start={it.track?.cues.find((c) => c.id === it.entry.mixInCueId)?.start ?? 0}
                  end={endOf(it)}
                  endFx={it.entry.endFx ?? it.track?.endFx ?? []}
                  onKey={(key) => setKey(it, key)}
                  onBpm={(bpm) => setBpm(it, bpm)}
                  onStart={(s) => mixPoint(it, 'in', s || undefined)}
                  onEnd={(s) => mixPoint(it, 'out', s !== undefined && it.track?.duration && s >= it.track.duration - 0.5 ? undefined : s)}
                  onEndFx={(endFx) => dispatch({ type: 'updateEntry', id: it.entry.id, patch: { endFx } })}
                  left={
                    <span
                      className="m-handle"
                      role="button"
                      aria-label={`move ${it.track?.title ?? 'track'}`}
                      title="drag to move"
                      onPointerDown={(e) => {
                        e.currentTarget.setPointerCapture(e.pointerId);
                        const y0 = e.clientY;
                        setDrag({ idx: i, dy: 0 });
                        const el = e.currentTarget;
                        const move = (ev: PointerEvent) => setDrag({ idx: i, dy: ev.clientY - y0 });
                        const up = (ev: PointerEvent) => {
                          el.removeEventListener('pointermove', move);
                          el.removeEventListener('pointerup', up);
                          el.removeEventListener('pointercancel', up);
                          const to = Math.max(0, Math.min(items.length - 1, i + Math.round((ev.clientY - y0) / ROW)));
                          setDrag(null);
                          if (to !== i && ev.type === 'pointerup') {
                            const ids = items.map((x) => x.entry.id);
                            ids.splice(to, 0, ...ids.splice(i, 1));
                            dispatch({ type: 'reorderEntries', ids });
                          }
                        };
                        el.addEventListener('pointermove', move);
                        el.addEventListener('pointerup', up);
                        el.addEventListener('pointercancel', up);
                      }}
                    >
                      <HandleIcon />
                    </span>
                  }
                  right={
                    <div className="m-menu-wrap">
                      <button type="button" className="m-round" aria-label={`more for ${it.track?.title ?? 'track'}`} onClick={() => setMenu(menu === it.entry.id ? null : it.entry.id)}>
                        <DotsIcon />
                      </button>
                      {menu === it.entry.id && (
                        <EntryMenu
                          entry={it.entry}
                          onPlay={() => {
                            setMenu(null);
                            night.play(it.startsAt);
                          }}
                          onRemove={() => {
                            setMenu(null);
                            dispatch({ type: 'removeEntry', id: it.entry.id });
                          }}
                          onClose={() => setMenu(null)}
                        />
                      )}
                    </div>
                  }
                />
                <WaveStrip
                  it={it}
                  mode={mode}
                  activeRegionId={activeRegionId}
                  loopIn={loopIn?.entryId === it.entry.id ? loopIn.s : undefined}
                />
              </div>
              <Ruler side="right" i={i} items={items} label={clockLabel(it.startsAt, set.startClock)} />
            </div>
          ))}
          <div className="m-row-end">
            <span className="m-ruler-label">{clockLabel(end, set.startClock)}</span>
            <span className="grow" />
            <span className="m-ruler-label">{clockLabel(end, set.startClock)}</span>
          </div>
          {footer}
        </div>
        </>
      )}
    </div>
  );
}

const NO_STRETCH =
  'Changing the key needs key lock, which this page can’t do: it needs the Mac app, or Setcraft from an https address. Over Wi-Fi from your Mac, the phone plays it in its own key.';

function endOf(it: TimelineItem): number | undefined {
  const t = it.track;
  if (!t) return undefined;
  return t.cues.find((c) => c.id === it.entry.mixOutCueId)?.start ?? t.duration;
}

function EntryMenu({ entry, onPlay, onRemove, onClose }: { entry: SetEntry; onPlay: () => void; onRemove: () => void; onClose: () => void }) {
  return (
    <>
      <div className="m-scrim" onClick={onClose} />
      <div className="m-popover m-entry-menu" role="menu" data-entry={entry.id}>
        <button role="menuitem" onClick={onPlay}>
          play from here
        </button>
        <button role="menuitem" className="danger" onClick={onRemove}>
          remove from night
        </button>
      </div>
    </>
  );
}

/** A row's stretch of the clock ruler: its start time and ticks; red while it plays, with a marker where the night is. */
const Ruler = memo(function Ruler({ side, i, items, label }: { side: 'left' | 'right'; i: number; items: TimelineItem[]; label: string }) {
  return (
    <div className={`m-ruler ${side}`} aria-hidden="true">
      <span className="m-ruler-label">{label}</span>
      <i className="major" />
      <i className="minor" style={{ top: '25%' }} />
      <i className="minor" style={{ top: '50%' }} />
      <i className="minor" style={{ top: '75%' }} />
      <Live i={i} items={items} side={side} />
    </div>
  );
});

function Live({ i, items, side }: { i: number; items: TimelineItem[]; side: 'left' | 'right' }) {
  const t = useNightTime();
  if (itemIndexAt(items, t) !== i) return null;
  const it = items[i];
  const f = Math.max(0, Math.min(1, (t - it.startsAt) / Math.max(1, it.playFor)));
  return (
    <>
      <div className="m-ruler-band" data-playing={side === 'left' ? 'true' : undefined} />
      <span className={`m-ruler-mark ${side}`} style={{ top: `${f * 100}%` }}>
        {side === 'left' ? '▸' : '◂'}
      </span>
    </>
  );
}
