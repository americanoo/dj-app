import { useMemo, useState } from 'react';
import { EXPORT_TARGETS, exportCollection, exportFor, type CollectionTarget, type ExportTarget } from '../core/formats';
import { safeName } from '../core/formats/rekordbox';
import { planCues, setPlanMarkdown, withPlanCues } from '../core/setplan';
import { isChangedInSetcraft, type Track } from '../core/model';
import { activeSet, useStore } from './store';
import { useLicense } from './license';
import { FOUNDING } from '../config';

type Scope = 'set' | 'edited' | 'playlist' | 'library';


/** How to load a collection export (as opposed to a single playlist). */
const COLLECTION_HOWTO: Partial<Record<ExportTarget, string[]>> = {
  rekordbox: [
    'rekordbox → Preferences → Advanced → Database → rekordbox xml: choose the exported file.',
    'In the tree view open "rekordbox xml" → All Tracks (or the "Setcraft updates" playlist), select the tracks, right-click → Import To Collection.',
    'Tracks that are new to rekordbox arrive with your hot cues, memory cues, loops and grids. rekordbox can keep its own cues for tracks that are already in its collection, so check a couple of those after importing.',
  ],
  traktor: [
    'Traktor → File → Import Another Collection, and choose the .nml file.',
    'Traktor merges it into your collection: the tracks take the cues, loops and grids set in Setcraft. Hot cues map to pads 1-8; Traktor ignores cue colours.',
    'Playlists in the file (Setcraft updates, your set) appear under Playlists.',
  ],
  djay: [
    'djay Pro reads rekordbox XML libraries, including hot cues and loops.',
    'Enable rekordbox in djay Pro\'s library sources and point it at the exported file (menu names vary between djay versions).',
  ],
};

function download(fileName: string, data: string | Uint8Array, mime: string) {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExportPanel({
  toast,
  onUpgrade,
}: {
  toast: (text: string, kind?: 'info' | 'error') => void;
  onUpgrade: () => void;
}) {
  const { project } = useStore();
  const { unlocked } = useLicense();
  const set = activeSet(project);
  const lib = project.library;
  /** collection: the tracks themselves with their cues (the main job). playlist: just an ordered list. */
  const [mode, setMode] = useState<'collection' | 'playlist'>('collection');
  const [target, setTarget] = useState<ExportTarget>('rekordbox');
  const setTrackIds = useMemo(() => [...new Set(set.entries.map((e) => e.trackId))].filter((id) => lib.tracks[id]), [set.entries, lib.tracks]);
  const changedIds = useMemo(() => Object.values(lib.tracks).filter(isChangedInSetcraft).map((t) => t.id), [lib.tracks]);
  const libraryCount = Object.keys(lib.tracks).length;

  // collection mode
  const [which, setWhich] = useState<'changed' | 'all'>(changedIds.length ? 'changed' : 'all');
  const [withSet, setWithSet] = useState(false);
  const [withUpdatesList, setWithUpdatesList] = useState(true);
  // The night's transitions, written into the tracks as memory cues.
  const mixCues = useMemo(() => planCues(set, lib), [set, lib]);
  const mixCueTracks = Object.keys(mixCues);
  const mixCueCount = Object.values(mixCues).reduce((n, c) => n + c.length, 0);
  const [withMixCues, setWithMixCues] = useState(mixCueCount > 0);
  const useMixCues = withMixCues && mixCueCount > 0;
  // playlist mode
  const [scope, setScope] = useState<Scope>(setTrackIds.length ? 'set' : 'library');
  const [playlistId, setPlaylistId] = useState(lib.playlists[0]?.id ?? '');
  const [name, setName] = useState('');

  const [pathFrom, setPathFrom] = useState('');
  const [pathTo, setPathTo] = useState('');
  const [macVolume, setMacVolume] = useState('');
  const [offsetMs, setOffsetMs] = useState(0);
  const [learned, setLearned] = useState(true);
  const [notes, setNotes] = useState<string[]>([]);

  const collectionTargets = new Set<ExportTarget>(['rekordbox', 'traktor', 'djay']);
  const effectiveTarget: ExportTarget = mode === 'collection' && !collectionTargets.has(target) ? 'rekordbox' : target;
  const info = EXPORT_TARGETS.find((t) => t.id === effectiveTarget)!;

  const playlistTrackIds = useMemo(() => {
    if (scope === 'set') return set.entries.map((e) => e.trackId);
    if (scope === 'edited') return changedIds;
    if (scope === 'playlist') return lib.playlists.find((p) => p.id === playlistId)?.trackIds ?? [];
    return Object.keys(lib.tracks);
  }, [scope, set.entries, lib, playlistId, changedIds]);

  // Collection: the chosen tracks, plus the set's tracks when the set goes along as a playlist.
  const collectionIds = useMemo(() => {
    const ids = which === 'changed' ? changedIds : Object.keys(lib.tracks);
    // Tracks gaining mix-point cues have changed too.
    const extra = [...(withSet ? setTrackIds : []), ...(useMixCues ? mixCueTracks : [])];
    return extra.length ? [...new Set([...ids, ...extra])] : ids;
  }, [which, changedIds, lib.tracks, withSet, setTrackIds, useMixCues, mixCueTracks]);

  const trackIds = mode === 'collection' ? collectionIds : playlistTrackIds;
  const tracks = useMemo(() => {
    const seen = new Set<string>();
    const out: Track[] = [];
    for (const id of trackIds) {
      const t = lib.tracks[id];
      if (t && !seen.has(id)) {
        seen.add(id);
        out.push(t);
      }
    }
    return out;
  }, [trackIds, lib.tracks]);

  const cueCount = tracks.reduce((n, t) => n + t.cues.length, 0);
  const timebase = effectiveTarget === 'rekordbox' || effectiveTarget === 'traktor' ? effectiveTarget : undefined;
  const withLearned = timebase ? tracks.filter((t) => t.sourceOffsets?.[timebase]).length : 0;
  const withoutPath = tracks.filter((t) => !t.path).length;

  const playlist = lib.playlists.find((p) => p.id === playlistId);
  const defaultName =
    scope === 'set' ? set.name : scope === 'edited' ? 'Setcraft edits' : scope === 'playlist' ? (playlist?.name ?? set.name) : 'Setcraft library';
  const common = {
    pathFrom: pathFrom || undefined,
    pathTo,
    macVolumeName: macVolume || undefined,
    offsetMs,
    applyLearnedOffsets: learned,
  };

  // Without a Founding DJ pass an export holds a few tracks: enough to try it in your own software.
  const limited = !unlocked && tracks.length > FOUNDING.freeExportTracks;

  const run = (onlyFirst?: number) => {
    const allowed = onlyFirst ? new Set(tracks.slice(0, onlyFirst).map((t) => t.id)) : undefined;
    const keep = (ids: string[]) => (allowed ? ids.filter((id) => allowed.has(id)) : ids);
    const chosen = allowed ? tracks.filter((t) => allowed.has(t.id)) : tracks;
    const tracks_ = useMixCues ? withPlanCues(chosen, mixCues) : chosen;
    try {
      let result: { file: { fileName: string; data: string | Uint8Array; mime: string }; notes: string[] };
      if (mode === 'collection') {
        const lists: { name: string; trackIds: string[] }[] = [];
        if (withUpdatesList && which === 'changed') lists.push({ name: 'Setcraft updates', trackIds: keep(changedIds) });
        if (withSet && setTrackIds.length) lists.push({ name: set.name, trackIds: keep(set.entries.map((e) => e.trackId)) });
        result = exportCollection(effectiveTarget as CollectionTarget, tracks_, lists, {
          ...common,
          playlistName: which === 'changed' ? 'Setcraft updated tracks' : 'Setcraft collection',
        });
      } else {
        result = exportFor(effectiveTarget, tracks_, keep(playlistTrackIds), { ...common, playlistName: name || defaultName });
      }
      download(result.file.fileName, result.file.data, result.file.mime);
      setNotes(result.notes);
      toast(`Exported ${result.file.fileName}`);
    } catch (e) {
      toast(`Export failed: ${(e as Error).message}`, 'error');
    }
  };

  const howTo = mode === 'collection' ? (COLLECTION_HOWTO[effectiveTarget] ?? info.howToImport) : info.howToImport;

  return (
    <div className="export">
      <section className="card">
        <div className="card-head">
          <h3>Export to your DJ software</h3>
        </div>
        <div className="snap-control export-mode" role="radiogroup" aria-label="What kind of export">
          <button role="radio" aria-checked={mode === 'collection'} className={mode === 'collection' ? 'on' : ''} onClick={() => setMode('collection')}>
            Collection with your cues
          </button>
          <button role="radio" aria-checked={mode === 'playlist'} className={mode === 'playlist' ? 'on' : ''} onClick={() => setMode('playlist')}>
            Playlist only
          </button>
        </div>
        <p className="muted small-text export-mode-hint">
          {mode === 'collection'
            ? 'Your tracks with the hot cues, memory cues, loops and grids set here, to update your DJ software’s own collection. The timeline doesn’t matter.'
            : 'An ordered list of tracks (your set, a playlist or the library) to load as a playlist.'}
        </p>

        <div className="targets">
          {EXPORT_TARGETS.map((t) => {
            const unavailable = mode === 'collection' && !collectionTargets.has(t.id);
            return (
              <button
                key={t.id}
                className={`target ${effectiveTarget === t.id ? 'active' : ''}`}
                disabled={unavailable}
                title={unavailable ? 'This format holds a playlist only, not cues: use “Playlist only”.' : undefined}
                onClick={() => setTarget(t.id)}
              >
                <span className="target-label">{t.label}</span>
                <span className={`badge ${t.carriesCues ? 'ok' : 'warn'}`}>{t.carriesCues ? 'cues + loops' : 'order only'}</span>
              </button>
            );
          })}
        </div>

        {mode === 'collection' ? (
          <div className="export-collection">
            <div className="snap-control" role="radiogroup" aria-label="Which tracks">
              <button role="radio" aria-checked={which === 'changed'} className={which === 'changed' ? 'on' : ''} disabled={!changedIds.length} onClick={() => setWhich('changed')}>
                Changed in Setcraft ({changedIds.length.toLocaleString()})
              </button>
              <button role="radio" aria-checked={which === 'all'} className={which === 'all' ? 'on' : ''} onClick={() => setWhich('all')}>
                Whole collection ({libraryCount.toLocaleString()})
              </button>
            </div>
            {which === 'changed' && (
              <label className="inline toggle">
                <input type="checkbox" checked={withUpdatesList} onChange={(e) => setWithUpdatesList(e.target.checked)} />
                Add a “Setcraft updates” playlist listing them, so they’re easy to find
              </label>
            )}
            <MixCuesToggle checked={useMixCues} disabled={!mixCueCount} count={mixCueCount} tracks={mixCueTracks.length} setName={set.name} onChange={setWithMixCues} />
            <label className="inline toggle">
              <input type="checkbox" checked={withSet} disabled={!setTrackIds.length} onChange={(e) => setWithSet(e.target.checked)} />
              Also add the set “{set.name}” as a playlist ({setTrackIds.length} track{setTrackIds.length === 1 ? '' : 's'}, in timeline order)
            </label>
          </div>
        ) : (
          <div className="row wrap">
            <label>
              What to export
              <select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
                <option value="set">
                  Current set: {set.name} ({setTrackIds.length} track{setTrackIds.length === 1 ? '' : 's'})
                </option>
                <option value="edited" disabled={!changedIds.length}>
                  Tracks changed in Setcraft ({changedIds.length})
                </option>
                <option value="playlist" disabled={!lib.playlists.length}>
                  An imported playlist
                </option>
                <option value="library">Whole library ({libraryCount.toLocaleString()})</option>
              </select>
            </label>
            {scope === 'playlist' && (
              <label>
                Playlist
                <select value={playlistId} onChange={(e) => setPlaylistId(e.target.value)}>
                  {lib.playlists.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <MixCuesToggle checked={useMixCues} disabled={!mixCueCount} count={mixCueCount} tracks={mixCueTracks.length} setName={set.name} onChange={setWithMixCues} />
            <label className="grow">
              Playlist name in the export
              <input value={name} placeholder={defaultName} onChange={(e) => setName(e.target.value)} />
            </label>
          </div>
        )}

        <details className="advanced">
          <summary>Advanced: moving between computers, drives and decoders</summary>
          <div className="row wrap">
            <label className="grow">
              Replace path prefix
              <input value={pathFrom} placeholder="/Users/me/Music" onChange={(e) => setPathFrom(e.target.value)} />
            </label>
            <label className="grow">
              with
              <input value={pathTo} placeholder="D:/Music" onChange={(e) => setPathTo(e.target.value)} />
            </label>
            {effectiveTarget === 'traktor' && (
              <label>
                macOS system volume name
                <input value={macVolume} placeholder="Macintosh HD" onChange={(e) => setMacVolume(e.target.value)} />
              </label>
            )}
            <label title="Some MP3s decode with a small offset in different programs. Shift every cue and grid by this many milliseconds.">
              Cue offset (ms)
              <input type="number" step={1} value={offsetMs} onChange={(e) => setOffsetMs(Number(e.target.value) || 0)} />
            </label>
          </div>
          {timebase && (
            <label className="inline toggle">
              <input type="checkbox" checked={learned} onChange={(e) => setLearned(e.target.checked)} />
              Apply per-track timing offsets learned while merging ({withLearned} track{withLearned === 1 ? '' : 's'} affected)
            </label>
          )}
        </details>

        <div className="export-summary">
          <span>
            <b>{tracks.length.toLocaleString()}</b> track{tracks.length === 1 ? '' : 's'} · <b>{cueCount.toLocaleString()}</b> cue
            {cueCount === 1 ? '' : 's'} &amp; loops
            {withoutPath > 0 && <span className="warn"> · {withoutPath} without a file location will be skipped</span>}
          </span>
          {limited ? (
            <span className="export-actions">
              <button onClick={() => run(FOUNDING.freeExportTracks)} title="Export the first few tracks to check it works in your software">
                Try it: first {FOUNDING.freeExportTracks} tracks
              </button>
              <button className="primary big" onClick={onUpgrade}>
                ★ Unlock all {tracks.length.toLocaleString()}: Founding DJ
              </button>
            </span>
          ) : (
            <button className="primary big" disabled={!tracks.length} onClick={() => run()}>
              Download {info.label}
            </button>
          )}
        </div>
        {limited && (
          <div className="export-limit">
            The free version exports up to {FOUNDING.freeExportTracks} tracks at a time, so you can check your cues land right in
            your DJ software. The Founding DJ pass ({FOUNDING.price}, {FOUNDING.priceNote}) exports everything.
          </div>
        )}
        {mode === 'collection' && which === 'changed' && !changedIds.length && (
          <div className="hint-line">Nothing has been changed in Setcraft yet. Set some cues, or export the whole collection.</div>
        )}
        {notes.map((n) => (
          <div key={n} className="hint-line">
            {n}
          </div>
        ))}
      </section>

      <section className="card">
        <div className="card-head">
          <h3>How to import it into {info.label.replace(/ \(.*\)$/, '')}</h3>
        </div>
        <ol className="howto">
          {howTo.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className="muted">
          Tip: import into a test playlist first and check a couple of cues against the waveform before a gig.
        </p>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Take the plan with you</h3>
        </div>
        <div className="row wrap">
          <button
            onClick={() =>
              download(`${safeName(set.name)} run sheet.md`, setPlanMarkdown(set, project.library), 'text/markdown')
            }
          >
            Run sheet (Markdown)
          </button>
          <button onClick={() => download(`${safeName(set.name)} run sheet.txt`, setPlanMarkdown(set, project.library), 'text/plain')}>
            Run sheet (text)
          </button>
          <button onClick={() => download('setcraft-project.json', JSON.stringify(project), 'application/json')}>
            Back up whole project (JSON)
          </button>
        </div>
        <p className="muted">
          The run sheet lists every chapter, track, transition note and hot cue. Import a project backup (JSON) to restore
          everything on another browser or computer.
        </p>
      </section>
    </div>
  );
}

/** Write the night's transitions into the tracks as memory cues. */
function MixCuesToggle(p: { checked: boolean; disabled: boolean; count: number; tracks: number; setName: string; onChange: (v: boolean) => void }) {
  return (
    <label
      className="inline toggle"
      title="Memory cues on each track: where to bring the next one in (with the blend), where it goes out, where it comes in from, and the bass swap. Only in the export; your cues here don't change."
    >
      <input type="checkbox" checked={p.checked} disabled={p.disabled} onChange={(e) => p.onChange(e.target.checked)} />
      {p.disabled
        ? `Add the night’s mix points as memory cues (none yet: “${p.setName}” needs two tracks that follow each other)`
        : `Add the night’s mix points as memory cues (${p.count} on ${p.tracks} track${p.tracks === 1 ? '' : 's'} of “${p.setName}”)`}
    </label>
  );
}
