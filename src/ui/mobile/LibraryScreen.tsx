import { useMemo, useState } from 'react';
import type { Track } from '../../core/model';
import { matchesFilter, sortTracks } from '../../core/listsort';
import { buildTimeline } from '../../core/setplan';
import { setTrackMixPoint, trackMixCue } from '../../core/trackfx';
import { LinkFolderButton } from '../MusicFolderControl';
import { notify } from '../toastBus';
import { activeSet, useStore } from '../store';
import { CheckIcon, PlusSmall, SearchIcon } from './icons';
import { ListTools, useListPrefs } from './ListTools';
import { TrackCard } from './TrackCard';

const PAGE = 60;

/** "LOAD MUSIC": the library as cards. Start, end and end effects set here are the track's defaults in any night. */
export function LibraryScreen({ onImport, onDemo, demoBusy, header }: { onImport: () => void; onDemo: () => void; demoBusy: boolean; header: React.ReactNode }) {
  const { project, dispatch } = useStore();
  const set = activeSet(project);
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [prefs, setPrefs] = useListPrefs('library', { sort: 'title', desc: false, filter: {} });
  const all = useMemo(() => Object.values(project.library.tracks), [project.library.tracks]);
  const inNight = useMemo(() => {
    const n = new Map<string, number>();
    for (const e of set.entries) n.set(e.trackId, (n.get(e.trackId) ?? 0) + 1);
    return n;
  }, [set.entries]);
  // The track the night ends on: "fits after" finds what could come next.
  const lastTrack = useMemo(() => {
    const items = buildTimeline(set, project.library);
    return items.reduce<(typeof items)[number] | undefined>((a, b) => (!a || b.startsAt + b.playFor >= a.startsAt + a.playFor ? b : a), undefined)?.track;
  }, [set, project.library]);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const tracks = useMemo(() => {
    const f = { ...prefs.filter, fitsAfter: prefs.filter.fitsAfter && lastTrack ? lastTrack : undefined };
    const found = all.filter(
      (t) =>
        (!words.length || words.every((w) => `${t.title} ${t.artist} ${t.key ?? ''} ${t.bpm ?? ''}`.toLowerCase().includes(w))) &&
        matchesFilter(t, f, (id) => inNight.has(id)),
    );
    return sortTracks(found, prefs.sort, prefs.desc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, q, prefs, lastTrack, inNight]);

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
    dispatch({ type: 'addEntries', trackIds: [t.id], blend: true });
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
      <ListTools
        label="library"
        prefs={prefs}
        onPrefs={(p) => (setPrefs(p), setShown(PAGE))}
        shown={tracks.length}
        total={all.length}
        extra={
          <>
            <div className="m-tools-row">
              <span>night</span>
              {(
                [
                  [undefined, 'all'],
                  [false, 'not in it'],
                  [true, 'in it'],
                ] as const
              ).map(([v, l]) => (
                <button key={l} className={`m-chip${prefs.filter.inNight === v ? ' on' : ''}`} aria-pressed={prefs.filter.inNight === v} onClick={() => setPrefs({ ...prefs, filter: { ...prefs.filter, inNight: v } })}>
                  {l}
                </button>
              ))}
            </div>
            <div className="m-tools-row">
              <button
                className={`m-chip${prefs.filter.fitsAfter ? ' on' : ''}`}
                aria-pressed={!!prefs.filter.fitsAfter}
                disabled={!lastTrack}
                onClick={() => setPrefs({ ...prefs, filter: { ...prefs.filter, fitsAfter: prefs.filter.fitsAfter ? undefined : { key: lastTrack?.key, bpm: lastTrack?.bpm } } })}
                title="a key that mixes and within 6% tempo of the night's last track"
              >
                fits after {lastTrack ? `“${lastTrack.title}”` : 'the last track'}
              </button>
            </div>
          </>
        }
      />
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
        {!tracks.length && <p className="m-muted m-pad">No track matches{q ? ` “${q}”` : ''}{prefs.filter && Object.values(prefs.filter).some((v) => v !== undefined) ? ' these filters' : ''}.</p>}
        {tracks.length > shown && (
          <button className="m-text-btn" onClick={() => setShown((s) => s + PAGE * 2)}>
            Show more ({(tracks.length - shown).toLocaleString()} left)
          </button>
        )}
      </div>
    </div>
  );
}
