import { useState } from 'react';
import { useDesktop } from './desktop';

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const ago = (ms: number) => {
  const d = Math.floor((Date.now() - ms) / 86400_000);
  return d <= 0 ? 'updated today' : d === 1 ? 'updated yesterday' : `updated ${d} days ago`;
};

/**
 * "Where is your music?": the Mac app's music folders (scanned into the
 * library), and optionally the DJ software's collection for cues and playlists,
 * kept in sync. Shown on first launch, and from ⋯ → Music folders.
 */
export function MusicSetup({ welcome, onClose }: { welcome: boolean; onClose: () => void }) {
  const d = useDesktop();
  const [keepSynced, setKeepSynced] = useState(true);
  const [importing, setImporting] = useState<string | null>(null);
  const songsIn = (folder: string) => d.entries.filter((e) => e.path.startsWith(folder.endsWith('/') ? folder : folder + '/')).length;
  const synced = d.settings.collection;

  const bring = async (path: string | undefined) => {
    if (!path) return;
    setImporting(path);
    try {
      await d.importCollection(path, keepSynced);
    } finally {
      setImporting(null);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Music folders">
      <div className="modal music-setup">
        <header className="modal-head">
          <h2>{welcome ? 'Welcome to Setcraft' : 'Music folders'}</h2>
          <p className="muted">
            Where is your music? Setcraft reads your songs where they are, on this Mac or a drive: nothing is copied.
          </p>
        </header>
        <div className="modal-body">
          <ul className="ms-folders">
            {d.settings.folders.map((f) => (
              <li key={f}>
                <span className="ms-folder-name" title={f}>
                  ▸ {f}
                </span>
                <span className="muted ms-count">{d.scanning ? '…' : `${songsIn(f).toLocaleString()} songs`}</span>
                <button className="icon danger" onClick={() => void d.removeFolder(f)} title="Stop using this folder (the tracks stay in your library)" aria-label={`Remove ${f}`}>
                  ✕
                </button>
              </li>
            ))}
            {!d.settings.folders.length && <li className="muted">No music folders yet.</li>}
          </ul>
          <div className="row">
            <button className="primary" onClick={() => void d.addFolders()} disabled={!!d.scanning}>
              + Add folder or drive
            </button>
            {d.settings.folders.length > 0 && (
              <button onClick={() => void d.rescan()} disabled={!!d.scanning} title="Look for new, changed and moved songs">
                Rescan
              </button>
            )}
          </div>
          <div className="ms-status" aria-live="polite">
            {d.scanning ? (
              <>
                <div className="ms-progress">
                  <div style={{ width: d.scanning.total ? `${(100 * d.scanning.done) / d.scanning.total}%` : '4%' }} />
                </div>
                <span className="muted small-text">
                  Scanning {fileName(d.scanning.folder)}… {d.scanning.total ? `${d.scanning.done.toLocaleString()} of ${d.scanning.total.toLocaleString()}` : ''}
                </span>
              </>
            ) : d.entries.length ? (
              <span className="small-text">
                ✓ {d.entries.length.toLocaleString()} songs in your music folders
                {d.missing.length ? <span className="ms-missing"> · {d.missing.length} tracks missing their file</span> : ''}
              </span>
            ) : null}
          </div>

          <h3 className="ms-sub">Cues and playlists from your DJ software (optional)</h3>
          {d.libraries.map((lib) => (
            <div className="ms-lib" key={lib.path}>
              <span className="ms-lib-name">
                <b>{lib.name}</b>
                <span className="muted small-text">
                  {' '}
                  · collection.nml · {ago(lib.modified)}
                </span>
              </span>
              {synced === lib.path ? (
                <span className="ms-synced small-text">
                  ✓ Kept in sync{' '}
                  <button className="link" onClick={() => void d.stopSync()}>
                    Stop
                  </button>
                </span>
              ) : (
                <button onClick={() => void bring(lib.path)} disabled={!!importing}>
                  {importing === lib.path ? 'Importing…' : 'Import'}
                </button>
              )}
            </div>
          ))}
          {!d.libraries.length && <p className="muted small-text">No Traktor collection found on this Mac.</p>}
          {synced && !d.libraries.some((l) => l.path === synced) && (
            <p className="small-text ms-synced">
              ✓ Keeping {fileName(synced)} in sync{' '}
              <button className="link" onClick={() => void d.stopSync()}>
                Stop
              </button>
            </p>
          )}
          <div className="row ms-other">
            <button className="small" onClick={() => void d.chooseCollection().then(bring)} disabled={!!importing}>
              Choose a collection file…
            </button>
            <label className="inline small-text" title="When your DJ software saves its collection, new tracks and cues come in by themselves (your Setcraft edits are kept)">
              <input type="checkbox" checked={keepSynced} onChange={(e) => setKeepSynced(e.target.checked)} /> Keep in sync
            </label>
          </div>
        </div>
        <footer className="modal-foot">
          <span className="grow" />
          <button className="primary" onClick={onClose}>
            {welcome ? 'Continue' : 'Done'}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Tracks whose file is missing and wasn't found automatically: Locate one, and the rest of its folder follows. */
export function MissingFiles({ onClose }: { onClose: () => void }) {
  const d = useDesktop();
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Missing files" onClick={onClose}>
      <div className="modal missing-files" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Missing files</h2>
          <p className="muted">
            {d.missing.length
              ? `${d.missing.length} track${d.missing.length === 1 ? '' : 's'} can’t find ${d.missing.length === 1 ? 'its' : 'their'} file. Locate one, and the others in the same folder follow.`
              : 'Every track has its file. ✓'}
          </p>
        </header>
        <div className="modal-body">
          <ul className="mf-list">
            {d.missing.slice(0, 200).map((t) => (
              <li key={t.id}>
                <span className="mf-track">
                  <b>{t.title}</b>
                  <span className="muted"> · {t.artist}</span>
                  <span className="muted small-text mf-path" title={t.path}>
                    {t.path}
                  </span>
                </span>
                <button className="small" onClick={() => void d.locate(t)}>
                  Locate…
                </button>
              </li>
            ))}
          </ul>
          {d.missing.length > 200 && <p className="muted small-text">…and {d.missing.length - 200} more.</p>}
        </div>
        <footer className="modal-foot">
          <button onClick={() => void d.rescan()} disabled={!!d.scanning}>
            {d.scanning ? 'Scanning…' : 'Rescan music folders'}
          </button>
          <span className="grow" />
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
