import { useEffect, useState } from 'react';
import { type Project, type Track } from '../core/model';
import { useStore } from './store';
import { PadStrip } from './MergeReview';
import { formatWhen, useVersions } from './versions';
import { cueDiffSummary, cueHistory, type CueHistoryEntry, type VersionMeta } from '../core/versions';

/** Earlier states of this track's cues from saved versions, with one-click restore. */
export function CueHistory({ track, autoLoad = false }: { track: Track; autoLoad?: boolean }) {
  const { project, dispatch } = useStore();
  const { versions, load, save } = useVersions();
  const [entries, setEntries] = useState<CueHistoryEntry[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const show = async () => {
    setLoadingHistory(true);
    try {
      const snapshots = await Promise.all(
        versions.map(async (meta) => ({ meta, project: await load(meta.id) })),
      );
      setEntries(
        cueHistory(
          track.id,
          track.cues,
          snapshots.filter((s): s is { meta: VersionMeta; project: Project } => !!s.project),
        ),
      );
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (autoLoad && versions.length) void show();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh when the track's cues change (e.g. after a restore).
  useEffect(() => {
    if (entries) void show();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.cues, versions]);

  const restore = async (e: CueHistoryEntry) => {
    await save(project, `Before restoring cues of ${track.artist} – ${track.title}`, true).catch(() => undefined);
    // Restored cues count as edits made here, so later imports won't overwrite them.
    dispatch({ type: 'setCues', trackId: track.id, cues: e.cues.map((c) => ({ ...c, edited: true, pinned: undefined })) });
  };

  return (
    <section className="card">
      <div className="card-head">
        <h3>Earlier versions of these cues</h3>
        <span className="muted">From your saved versions</span>
        {!entries && (
          <button className="small" disabled={loadingHistory || !versions.length} onClick={() => void show()}>
            {versions.length ? (loadingHistory ? 'Loading…' : 'Show history') : 'No saved versions yet'}
          </button>
        )}
      </div>
      {entries && !entries.length && <p className="muted">These cues haven't changed in any saved version.</p>}
      {entries?.map((e) => (
        <div key={e.version.id} className="history-row">
          <div className="history-meta">
            <b>{e.version.name}</b>
            <span className="muted small-text">
              {formatWhen(e.version.createdAt)} · {e.cues.length} cue{e.cues.length === 1 ? '' : 's'}
            </span>
            <ul className="diff-list">
              {cueDiffSummary(e.cues, track.cues).map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </div>
          <PadStrip label="" cues={e.cues} />
          <button className="small" onClick={() => void restore(e)}>
            Restore these cues
          </button>
        </div>
      ))}
    </section>
  );
}
