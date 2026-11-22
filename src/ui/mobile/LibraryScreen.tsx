import { useMemo, useState } from 'react';
import type { Track } from '../../core/model';
import { setTrackMixPoint, trackMixCue } from '../../core/trackfx';
import { LinkFolderButton } from '../MusicFolderControl';
import { notify } from '../toastBus';
import { activeSet, useStore } from '../store';
import { CheckIcon, PlusSmall, SearchIcon } from './icons';
import { TrackCard } from './TrackCard';

const PAGE = 60;

/** "LOAD MUSIC": the library as cards. Start, end and end effects set here are the track's defaults in any night. */
export function LibraryScreen({ onImport, onDemo, demoBusy, header }: { onImport: () => void; onDemo: () => void; demoBusy: boolean; header: React.ReactNode }) {
  const { project, dispatch } = useStore();
  const set = activeSet(project);
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(PAGE);
  const all = useMemo(
    () => Object.values(project.library.tracks).sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' })),
    [project.library.tracks],
  );
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const tracks = words.length ? all.filter((t) => words.every((w) => `${t.title} ${t.artist} ${t.key ?? ''} ${t.bpm ?? ''}`.toLowerCase().includes(w))) : all;
  const inNight = useMemo(() => {
    const n = new Map<string, number>();
    for (const e of set.entries) n.set(e.trackId, (n.get(e.trackId) ?? 0) + 1);
    return n;
  }, [set.entries]);

  if (!all.length) {
    return (
      <div className="m-screen m-library">
        {header}
        <div className="m-empty">
          <p className="m-empty-lead">Bring in your music to build a night.</p>
          <button className="m-big-btn" onClick={onImport}>
            Import a collection or songs
            <small>Traktor NML, rekordbox XML, Serato, M3U, or audio files</small>
          </button>
          <div className="m-empty-link">
            <LinkFolderButton />
          </div>
          <button className="m-text-btn" onClick={onDemo} disabled={demoBusy}>
            {demoBusy ? 'Loading the demo…' : 'Or try the demo night'}
          </button>
        </div>
      </div>
    );
  }

  const add = (t: Track) => {
    dispatch({ type: 'addEntries', trackIds: [t.id] });
    notify(`“${t.title}” added to the night.`, 'info', { label: 'Undo', run: () => dispatch({ type: 'undo' }) });
  };

  return (
    <div className="m-screen m-library">
      {header}
      <div className="m-search">
        <SearchIcon />
        <input type="search" placeholder={`search ${all.length.toLocaleString()} tracks`} value={q} onChange={(e) => (setQ(e.target.value), setShown(PAGE))} aria-label="Search tracks" />
        <button className="m-chip" onClick={onImport} title="Import a collection or songs">
          import
        </button>
      </div>
      <div className="m-scroll m-cards">
        {tracks.slice(0, shown).map((t) => {
          const n = inNight.get(t.id) ?? 0;
          return (
            <TrackCard
              key={t.id}
              title={t.title}
              artist={t.artist}
              keyName={t.key}
              bpm={t.bpm}
              start={trackMixCue(t, 'in')?.start ?? 0}
              end={trackMixCue(t, 'out')?.start ?? t.duration}
              endFx={t.endFx ?? []}
              onKey={(key) => dispatch({ type: 'updateTrack', id: t.id, patch: { key } })}
              onBpm={(bpm) => bpm && dispatch({ type: 'updateTrack', id: t.id, patch: { bpm, bpmConfirmed: true } })}
              onStart={(s) => dispatch({ type: 'setCues', trackId: t.id, cues: setTrackMixPoint(t, 'in', s || undefined) })}
              onEnd={(s) => dispatch({ type: 'setCues', trackId: t.id, cues: setTrackMixPoint(t, 'out', s !== undefined && t.duration && s >= t.duration - 0.5 ? undefined : s) })}
              onEndFx={(endFx) => dispatch({ type: 'updateTrack', id: t.id, patch: { endFx } })}
              right={
                <button
                  type="button"
                  className={`m-round${n ? ' added' : ''}`}
                  aria-label={n ? `add to night playlist again (in it ${n === 1 ? 'once' : `${n} times`})` : 'add to night playlist'}
                  title="add to night playlist"
                  onClick={() => add(t)}
                >
                  {n ? <CheckIcon /> : <PlusSmall />}
                </button>
              }
            />
          );
        })}
        {!tracks.length && <p className="m-muted m-pad">No track matches “{q}”.</p>}
        {tracks.length > shown && (
          <button className="m-text-btn" onClick={() => setShown((s) => s + PAGE * 2)}>
            Show more ({(tracks.length - shown).toLocaleString()} left)
          </button>
        )}
      </div>
    </div>
  );
}
