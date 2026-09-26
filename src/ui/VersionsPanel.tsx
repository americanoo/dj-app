import { useState } from 'react';
import { MAX_AUTO_VERSIONS, missingTracksFor, type VersionMeta } from '../core/versions';
import { useStore } from './store';
import { formatWhen, useVersions } from './versions';

export function defaultVersionName(): string {
  const d = new Date();
  return `Version ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

export function VersionsPanel({
  onClose,
  toast,
}: {
  onClose: () => void;
  toast: (text: string, kind?: 'info' | 'error') => void;
}) {
  const { project, dispatch } = useStore();
  const { versions, save, load, rename, remove } = useVersions();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const saveNow = async () => {
    setBusy(true);
    try {
      const v = await save(project, name.trim() || defaultVersionName());
      setName('');
      toast(`Saved "${v.name}"`);
    } catch (e) {
      toast(`Couldn't save the version: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const restoreAll = async (v: VersionMeta) => {
    if (!confirm(`Restore everything to "${v.name}"? Your current state is saved as a version first, so you can undo this.`)) {
      return;
    }
    const snapshot = await load(v.id);
    if (!snapshot) return toast('That version could not be read.', 'error');
    await save(project, `Before restoring "${v.name}"`, true);
    dispatch({ type: 'load', project: snapshot });
    toast(`Restored "${v.name}"`);
    onClose();
  };

  const copySetOut = async (v: VersionMeta, setId: string) => {
    const snapshot = await load(v.id);
    const set = snapshot?.sets.find((s) => s.id === setId);
    if (!snapshot || !set) return toast('That set could not be read.', 'error');
    const tracks = missingTracksFor(set, snapshot, project);
    dispatch({ type: 'addSetCopy', set, name: `${set.name} (${v.name})`, tracks });
    toast(
      `Added "${set.name}" from "${v.name}" as a new set` +
        (tracks.length ? `, and brought back ${tracks.length} track${tracks.length === 1 ? '' : 's'} it needs` : ''),
    );
    onClose();
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="versions-title" onClick={onClose}>
      <div className="modal versions" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2 id="versions-title">Versions</h2>
          <p className="muted">
            Save a snapshot of everything (library, cues and sets) and go back to it any time. Snapshots stay in this
            browser. Use <i>Export → Back up whole project</i> to move them to another computer.
          </p>
        </header>

        <div className="row save-version">
          <input
            className="grow"
            value={name}
            placeholder={defaultVersionName()}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void saveNow()}
            aria-label="Version name"
            autoFocus
          />
          <button className="primary" disabled={busy} onClick={() => void saveNow()}>
            Save version
          </button>
        </div>

        <div className="version-list">
          {!versions.length && <p className="muted pad">No versions yet.</p>}
          {versions.map((v) => (
            <div key={v.id} className="version-row">
              <div className="version-main">
                <div className="version-name">
                  {v.name}
                  {v.auto && (
                    <span className="badge" title={`Automatic. The newest ${MAX_AUTO_VERSIONS} are kept; rename one to keep it for good.`}>
                      auto
                    </span>
                  )}
                </div>
                <div className="muted small-text">
                  {formatWhen(v.createdAt)} · {v.summary.tracks} tracks · {v.summary.cues} cues · {v.summary.sets.length} set
                  {v.summary.sets.length === 1 ? '' : 's'}
                </div>
              </div>
              <select
                value=""
                onChange={(e) => e.target.value && void copySetOut(v, e.target.value)}
                aria-label="Copy a set from this version"
                title="Add a set from this version as a new set, without changing anything else"
              >
                <option value="">Copy a set out…</option>
                {v.summary.sets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.entries} tracks)
                  </option>
                ))}
              </select>
              <button className="small" onClick={() => void restoreAll(v)}>
                Restore all
              </button>
              <button
                className="icon"
                title="Rename"
                onClick={() => {
                  const n = prompt('Version name', v.name);
                  if (n?.trim()) rename(v.id, n.trim());
                }}
              >
                ✎
              </button>
              <button
                className="icon danger"
                title="Delete version"
                onClick={() => confirm(`Delete version "${v.name}"?`) && remove(v.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <footer className="modal-foot">
          <span className="muted small-text grow">
            Setcraft also saves automatically before imports that change existing tracks and before every restore. Tip:{' '}
            <kbd>⌘/Ctrl</kbd>+<kbd>S</kbd> saves a version from anywhere.
          </span>
          <button onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}
