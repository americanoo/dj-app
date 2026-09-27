import { useRef, useState } from 'react';
import { useAudio } from './audio';
import { useMusicFolder } from './musicFolder';
import { activeSet, useStore } from './store';

/**
 * Link / reconnect the music folder.
 * - default: "Link music folder…" / "Change folder…"
 * - compact: hidden once linked (for the cue editor toolbar)
 * - topbar: always visible and shows the linked folder's name
 */
export function LinkFolderButton({ compact = false, topbar = false }: { compact?: boolean; topbar?: boolean }) {
  const folder = useMusicFolder();
  const input = useRef<HTMLInputElement>(null);

  const pick = () => (folder.supportsPicker ? void folder.link() : input.current?.click());
  const fallbackInput = (
    <input
      ref={input}
      type="file"
      hidden
      multiple
      // Folder selection in Safari / Firefox.
      {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
      onChange={(e) => {
        if (e.target.files?.length) folder.linkFiles(e.target.files);
        e.target.value = '';
      }}
    />
  );

  if (folder.status === 'needs-permission') {
    return (
      <button className={compact ? 'small' : 'small primary'} onClick={() => void folder.reconnect()}>
        Reconnect “{folder.folderName}”
      </button>
    );
  }
  if (folder.status === 'indexing') {
    return <span className="muted small-text">Scanning {folder.folderName}… {folder.fileCount} files</span>;
  }
  if (folder.status === 'ready' && compact) return null;
  const label = topbar
    ? folder.status === 'ready'
      ? `♫ ${folder.folderName}`
      : '♫ Link music folder'
    : folder.status === 'ready'
      ? 'Change folder…'
      : 'Link music folder…';
  const title =
    folder.status === 'ready'
      ? `Linked: ${folder.folderName} (${folder.fileCount.toLocaleString()} audio file${folder.fileCount === 1 ? '' : 's'}). Click to pick a different folder.`
      : "Pick the folder your music lives in (subfolders included). Setcraft finds each track's audio for waveforms and playback.";
  return (
    <>
      <button className={topbar ? '' : 'small'} onClick={pick} title={title}>
        {label}
      </button>
      {fallbackInput}
    </>
  );
}

/** Sidebar panel: folder status plus "analyse the set's waveforms". */
export function MusicFolderPanel() {
  const folder = useMusicFolder();
  const { project, dispatch } = useStore();
  const { audio, rememberedIds, attach } = useAudio();
  const [progress, setProgress] = useState<{ done: number; total: number; missing: number } | null>(null);

  const set = activeSet(project);
  const setTracks = [...new Set(set.entries.map((e) => e.trackId))]
    .map((id) => project.library.tracks[id])
    .filter(Boolean);
  const withWave = setTracks.filter((t) => audio[t.id] || rememberedIds.has(t.id)).length;
  const todo = setTracks.filter((t) => !audio[t.id] && !rememberedIds.has(t.id));

  const analyseSet = async () => {
    let missing = 0;
    setProgress({ done: 0, total: todo.length, missing });
    for (let i = 0; i < todo.length; i++) {
      const file = await folder.findFile(todo[i].path).catch(() => undefined);
      if (file) {
        const info = await attach(todo[i].id, file).catch(() => undefined);
        if (!info) missing++;
        else if (!todo[i].duration) dispatch({ type: 'updateTrack', id: todo[i].id, patch: { duration: info.duration } });
      } else missing++;
      setProgress({ done: i + 1, total: todo.length, missing });
    }
  };

  return (
    <div className="folder-panel">
      <h3>Music folder</h3>
      {folder.status === 'ready' && (
        <p className="small-text">
          <b>{folder.folderName}</b>
          <span className="muted">
            {' '}
            · {folder.fileCount.toLocaleString()} audio file{folder.fileCount === 1 ? '' : 's'}
            {folder.persistent ? '' : ' · this visit only'}
          </span>
        </p>
      )}
      {folder.status === 'none' && (
        <p className="muted small-text">Link the folder your music lives in and Setcraft finds each track's audio for waveforms.</p>
      )}
      {folder.status === 'needs-permission' && (
        <p className="muted small-text">Your browser needs a click to open “{folder.folderName}” again.</p>
      )}
      <div className="row wrap">
        <LinkFolderButton />
        {folder.status === 'ready' && (
          <button className="small danger" onClick={folder.unlink}>
            Unlink
          </button>
        )}
      </div>
      {setTracks.length > 0 && (
        <div className="small-text">
          <span className="muted">
            Waveforms for “{set.name}”: {withWave} of {setTracks.length}
          </span>
          {folder.status === 'ready' && todo.length > 0 && !progress && (
            <button className="small wide" onClick={() => void analyseSet()}>
              Analyse {todo.length} missing
            </button>
          )}
          {progress && (
            <div className="muted">
              {progress.done < progress.total
                ? `Analysing ${progress.done + 1} of ${progress.total}…`
                : `Done.${progress.missing ? ` ${progress.missing} not found in the folder.` : ''}`}
              {progress.done >= progress.total && (
                <>
                  {' '}
                  <button className="link" onClick={() => setProgress(null)}>
                    OK
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
