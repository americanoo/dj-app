import { memo, useCallback, useMemo, useRef, useState } from 'react';
import type { Track } from '../core/model';
import { DEFAULT_TEMPO_RANGE, FAST_GENRE_RANGE, findTempoFixes, isFastGenre, scaleTempo, type TempoFix } from '../core/tempo';
import { useStore } from './store';
import { useVersions } from './versions';

const RANGE_KEY = 'setcraft-tempo-range';

export function loadTempoRange() {
  try {
    const r = JSON.parse(localStorage.getItem(RANGE_KEY) ?? '');
    if (r.min > 0 && r.max > r.min) return { min: Number(r.min), max: Number(r.max) };
  } catch {
    // nothing saved yet
  }
  return DEFAULT_TEMPO_RANGE;
}

/** Ids of tracks whose BPM looks like a half- or double-time reading, with the DJ's range. */
export function useOddBpmIds(): Set<string> {
  const { project } = useStore();
  return useMemo(
    () => new Set(findTempoFixes(Object.values(project.library.tracks), loadTempoRange()).map((f) => f.trackId)),
    [project.library.tracks],
  );
}

/**
 * Checks every BPM in the library against the range the DJ's music really
 * sits in and fixes half / double-time readings in one go, after review.
 */
export function BpmFixPanel({
  onClose,
  toast,
}: {
  onClose: () => void;
  toast: (text: string, kind?: 'info' | 'error') => void;
}) {
  const { project, dispatch } = useStore();
  const { save } = useVersions();
  const [range, setRange] = useState(loadTempoRange);
  const [minText, setMinText] = useState(String(range.min));
  const [maxText, setMaxText] = useState(String(range.max));
  /** Ticks the DJ changed; otherwise a track is ticked unless they kept its BPM before. */
  const [ticks, setTicks] = useState<Map<string, boolean>>(new Map());
  const [busy, setBusy] = useState(false);
  const tracks = project.library.tracks;

  const fixes = useMemo(() => {
    const list = findTempoFixes(Object.values(tracks), range, true);
    const name = (f: TempoFix) => `${tracks[f.trackId].artist} ${tracks[f.trackId].title}`.toLowerCase();
    return list.sort((a, b) => a.from - b.from || name(a).localeCompare(name(b)));
  }, [tracks, range]);
  const isTicked = (id: string) => ticks.get(id) ?? !tracks[id].bpmConfirmed;
  const chosen = fixes.filter((f) => isTicked(f.trackId));
  const kept = fixes.filter((f) => !isTicked(f.trackId));

  const commitRange = (minS: string, maxS: string) => {
    const min = Number(minS);
    const max = Number(maxS);
    if (!(min > 0 && max > min)) return;
    const r = { min, max };
    setRange(r);
    try {
      localStorage.setItem(RANGE_KEY, JSON.stringify(r));
    } catch {
      // private mode: the range just isn't remembered
    }
  };

  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const toggle = useCallback(
    (id: string) =>
      setTicks((m) => new Map(m).set(id, !(m.get(id) ?? !tracksRef.current[id].bpmConfirmed))),
    [],
  );
  const tickAll = (on: boolean) => setTicks(new Map(fixes.map((f) => [f.trackId, on])));

  const apply = async () => {
    if (!fixes.length) return;
    setBusy(true);
    try {
      const n = chosen.length;
      const v = n ? await save(project, `Before fixing ${n} BPM${n === 1 ? '' : 's'}`, true) : undefined;
      const patches: Record<string, Partial<Track>> = {};
      for (const f of chosen) patches[f.trackId] = { ...scaleTempo(tracks[f.trackId], f.factor), bpmConfirmed: undefined };
      // Unticked ones are right as they are: stop flagging them.
      for (const f of kept) patches[f.trackId] = { bpmConfirmed: true };
      dispatch({ type: 'updateTracks', patches });
      const keptNote = kept.length ? ` Kept ${kept.length} as ${kept.length === 1 ? 'it is' : 'they are'}.` : '';
      toast(
        v
          ? `Fixed ${n} BPM${n === 1 ? '' : 's'}.${keptNote} To undo, restore "${v.name}" in Versions.`
          : `Kept ${kept.length} BPM${kept.length === 1 ? '' : 's'} as ${kept.length === 1 ? 'it is' : 'they are'}.`,
      );
      onClose();
    } catch (e) {
      toast(`Couldn't fix the BPMs: ${(e as Error).message}`, 'error');
      setBusy(false);
    }
  };

  const halfCount = fixes.filter((f) => f.factor > 1).length;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Fix BPMs" onClick={onClose}>
      <div className="modal bpm-fix" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Fix half / double-time BPMs</h2>
          <p>
            DJ software often reads a track at half or double its real tempo, like 62 instead of 124, or 192 instead of
            96. Set the range your music really sits in: anything slower is doubled, anything faster is halved. Beat
            grids stay on the same downbeat.
          </p>
        </header>
        <div className="modal-body">
          <div className="bpm-range">
            <label>
              Slowest
              <input
                type="number"
                min={40}
                max={200}
                value={minText}
                onChange={(e) => {
                  setMinText(e.target.value);
                  commitRange(e.target.value, maxText);
                }}
              />
            </label>
            <label>
              Fastest
              <input
                type="number"
                min={60}
                max={300}
                value={maxText}
                onChange={(e) => {
                  setMaxText(e.target.value);
                  commitRange(minText, e.target.value);
                }}
              />
            </label>
            <span className="muted">
              BPM · tracks tagged drum &amp; bass, jungle, footwork or hardcore use {FAST_GENRE_RANGE.min}–
              {FAST_GENRE_RANGE.max}
            </span>
          </div>

          {fixes.length ? (
            <>
              <div className="bpm-summary">
                <b>{fixes.length}</b> of {Object.keys(tracks).length} tracks look off: {halfCount} read at half speed,{' '}
                {fixes.length - halfCount} at double. Untick any that are right as they are.
                <span className="grow" />
                <span className="bpm-tick-all">
                  <button className="small" onClick={() => tickAll(true)}>
                    Tick all
                  </button>
                  <button className="small" onClick={() => tickAll(false)}>
                    Untick all
                  </button>
                </span>
              </div>
              <div className="bpm-list">
                {fixes.map((f) => (
                  <FixRow
                    key={f.trackId}
                    fix={f}
                    track={tracks[f.trackId]}
                    checked={isTicked(f.trackId)}
                    onToggle={toggle}
                  />
                ))}
              </div>
            </>
          ) : (
            <p className="bpm-none">Every BPM in your library is between {range.min} and {range.max}. Nothing to fix.</p>
          )}
        </div>
        <footer className="modal-foot">
          <span className="muted grow">
            Unticked tracks are remembered as right and stop being flagged. A version is saved first, so fixes can be
            undone from Versions.
          </span>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!fixes.length || busy} onClick={apply}>
            {chosen.length
              ? `Fix ${chosen.length} BPM${chosen.length === 1 ? '' : 's'}`
              : `Keep ${kept.length === 1 ? 'it' : 'them'} as ${kept.length === 1 ? 'it is' : 'they are'}`}
          </button>
        </footer>
      </div>
    </div>
  );
}

const FixRow = memo(function FixRow({
  fix,
  track,
  checked,
  onToggle,
}: {
  fix: TempoFix;
  track: Track;
  checked: boolean;
  onToggle: (id: string) => void;
}) {
  const label = fix.factor >= 1 ? `×${fix.factor}` : `×½`;
  return (
    <label className={`bpm-row ${checked ? '' : 'off'}`}>
      <input type="checkbox" checked={checked} onChange={() => onToggle(fix.trackId)} />
      <span className="bpm-track">
        <b>{track.title}</b> <span className="muted">{track.artist}</span>
      </span>
      <span className="bpm-genre muted">
        {track.genre}
        {isFastGenre(track.genre) && <span className="badge">fast genre</span>}
        {track.bpmConfirmed && <span className="badge">kept before</span>}
      </span>
      <span className="bpm-change">
        <span className="bpm-from">{fix.from.toFixed(1)}</span>
        <span className={`bpm-factor ${fix.factor > 1 ? 'up' : 'down'}`}>{label}</span>
        <span className="bpm-to">{fix.to.toFixed(1)}</span>
      </span>
    </label>
  );
});
