import { useMemo, useState } from 'react';
import { EXPORT_TARGETS, exportFor, type ExportTarget } from '../core/formats';
import { safeName } from '../core/formats/rekordbox';
import { setPlanMarkdown } from '../core/setplan';
import type { Track } from '../core/model';
import { activeSet, useStore } from './store';

type Scope = 'set' | 'edited' | 'playlist' | 'library';

/** Tracks whose cues or tempo were set or changed in Setcraft: the work to take back to the DJ software. */
function changedHere(t: Track): boolean {
  return t.tempoFix !== undefined || t.cues.some((c) => c.origin === 'manual' || c.edited);
}

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

export function ExportPanel({ toast }: { toast: (text: string, kind?: 'info' | 'error') => void }) {
  const { project } = useStore();
  const set = activeSet(project);
  const [target, setTarget] = useState<ExportTarget>('rekordbox');
  const setTrackIds = useMemo(() => [...new Set(set.entries.map((e) => e.trackId))].filter((id) => project.library.tracks[id]), [set.entries, project.library.tracks]);
  const editedIds = useMemo(
    () => Object.values(project.library.tracks).filter(changedHere).map((t) => t.id),
    [project.library.tracks],
  );
  const libraryCount = Object.keys(project.library.tracks).length;
  // Start with what's most likely wanted: the set if it's a real set, otherwise the tracks worked on here.
  const [scope, setScope] = useState<Scope>(() =>
    setTrackIds.length >= 2 ? 'set' : editedIds.length ? 'edited' : setTrackIds.length ? 'set' : 'library',
  );
  const [playlistId, setPlaylistId] = useState(project.library.playlists[0]?.id ?? '');
  const [name, setName] = useState('');
  const [pathFrom, setPathFrom] = useState('');
  const [pathTo, setPathTo] = useState('');
  const [macVolume, setMacVolume] = useState('');
  const [offsetMs, setOffsetMs] = useState(0);
  const [learned, setLearned] = useState(true);
  const [notes, setNotes] = useState<string[]>([]);

  const info = EXPORT_TARGETS.find((t) => t.id === target)!;

  const trackIds = useMemo(() => {
    if (scope === 'set') return set.entries.map((e) => e.trackId);
    if (scope === 'edited') return editedIds;
    if (scope === 'playlist') return project.library.playlists.find((p) => p.id === playlistId)?.trackIds ?? [];
    return Object.keys(project.library.tracks);
  }, [scope, set.entries, project.library, playlistId, editedIds]);

  const tracks = useMemo(() => {
    const seen = new Set<string>();
    const out: Track[] = [];
    for (const id of trackIds) {
      const t = project.library.tracks[id];
      if (t && !seen.has(id)) {
        seen.add(id);
        out.push(t);
      }
    }
    return out;
  }, [trackIds, project.library.tracks]);

  const cueCount = tracks.reduce((n, t) => n + t.cues.length, 0);
  const timebase = target === 'rekordbox' || target === 'traktor' ? target : undefined;
  const withLearned = timebase ? tracks.filter((t) => t.sourceOffsets?.[timebase]).length : 0;
  const withoutPath = tracks.filter((t) => !t.path).length;

  const playlist = project.library.playlists.find((p) => p.id === playlistId);
  const defaultName =
    scope === 'set' ? set.name : scope === 'edited' ? 'Setcraft edits' : scope === 'playlist' ? (playlist?.name ?? set.name) : 'Setcraft library';

  const run = () => {
    try {
      const { file, notes } = exportFor(target, tracks, trackIds, {
        playlistName: name || defaultName,
        pathFrom: pathFrom || undefined,
        pathTo,
        macVolumeName: macVolume || undefined,
        offsetMs,
        applyLearnedOffsets: learned,
      });
      download(file.fileName, file.data, file.mime);
      setNotes(notes);
      toast(`Exported ${file.fileName}`);
    } catch (e) {
      toast(`Export failed: ${(e as Error).message}`, 'error');
    }
  };

  return (
    <div className="export">
      <section className="card">
        <div className="card-head">
          <h3>Export to your DJ software</h3>
        </div>
        <div className="targets">
          {EXPORT_TARGETS.map((t) => (
            <button key={t.id} className={`target ${target === t.id ? 'active' : ''}`} onClick={() => setTarget(t.id)}>
              <span className="target-label">{t.label}</span>
              <span className={`badge ${t.carriesCues ? 'ok' : 'warn'}`}>{t.carriesCues ? 'order + cues + loops' : 'order only'}</span>
            </button>
          ))}
        </div>

        <div className="row wrap">
          <label>
            What to export
            <select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
              <option value="set">
                Current set: {set.name} ({setTrackIds.length} track{setTrackIds.length === 1 ? '' : 's'})
              </option>
              <option value="edited" disabled={!editedIds.length}>
                Tracks changed in Setcraft ({editedIds.length})
              </option>
              <option value="playlist" disabled={!project.library.playlists.length}>
                An imported playlist
              </option>
              <option value="library">Whole library ({libraryCount.toLocaleString()})</option>
            </select>
          </label>
          {scope === 'playlist' && (
            <label>
              Playlist
              <select value={playlistId} onChange={(e) => setPlaylistId(e.target.value)}>
                {project.library.playlists.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="grow">
            Playlist name in the export
            <input value={name} placeholder={defaultName} onChange={(e) => setName(e.target.value)} />
          </label>
        </div>
        {scope === 'set' && setTrackIds.length <= 1 && (editedIds.length > setTrackIds.length || libraryCount > 1) && (
          <div className="export-scope-warn">
            Your set “{set.name}” has {setTrackIds.length === 1 ? 'only 1 track' : 'no tracks'}, so that's all this exports.
            {editedIds.length > 0 && (
              <button className="small" onClick={() => setScope('edited')}>
                Export the {editedIds.length} track{editedIds.length === 1 ? '' : 's'} changed in Setcraft
              </button>
            )}
            <button className="small" onClick={() => setScope('library')}>
              Export the whole library ({libraryCount.toLocaleString()})
            </button>
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
            {target === 'traktor' && (
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
            <b>{tracks.length}</b> tracks · <b>{cueCount}</b> cues &amp; loops
            {withoutPath > 0 && <span className="warn"> · {withoutPath} without a file location will be skipped</span>}
          </span>
          <button className="primary big" disabled={!tracks.length} onClick={run}>
            Download {info.label}
          </button>
        </div>
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
          {info.howToImport.map((s) => (
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
