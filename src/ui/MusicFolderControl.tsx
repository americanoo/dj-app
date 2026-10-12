import { useRef, useState } from 'react';
import type { Track } from '../core/model';
import { buildIndex, findTrackFile } from '../core/pathmatch';
import { AUDIO_EXTENSIONS, useAudio } from './audio';
import { useMusicFolder, type AddMusicResult } from './musicFolder';
import { useIsPhone } from './phone';
import { activeSet, useStore } from './store';
import { notify } from './toastBus';
import { songsInZip } from './unzipMusic';

/** Audio types (and zips of them) for the picker. Listed by extension too, so phones offer every kind. */
const AUDIO_ACCEPT = 'audio/*,.mp3,.m4a,.aac,.mp4,.wav,.aif,.aiff,.flac,.ogg,.opus,.zip,application/zip';

/** What adding songs did, in one sentence or two. */
export function describeAdded(res: AddMusicResult, tracks: Record<string, Track>, where: string): string {
  const added = buildIndex(res.added);
  const used = new Set<string>();
  let matched = 0;
  for (const t of Object.values(tracks)) {
    const name = findTrackFile(t, added);
    if (name) {
      matched++;
      used.add(name);
    }
  }
  const n = res.added.length;
  const parts = [`${n} song${n === 1 ? '' : 's'} added to ${where}.`];
  if (Object.keys(tracks).length) {
    parts.push(`${matched} track${matched === 1 ? '' : 's'} in your library now ${matched === 1 ? 'has its' : 'have their'} audio.`);
    const unmatched = res.added.filter((name) => !used.has(name));
    if (unmatched.length) parts.push(`${unmatched.length} didn't match a track (like “${unmatched[0]}”).`);
  }
  if (res.notKept) parts.push(`${res.notKept} couldn't be kept (storage full) and play only until the page is closed.`);
  return parts.join(' ');
}

/**
 * Add songs that stay on this device: the way to get music onto a phone, where
 * folders can't be linked. Picked from the Files app they can come from the
 * phone, iCloud or a drive plugged into it; each is matched to its track by name.
 * Everything at once: pick a whole folder (`folder`), or a .zip of one.
 */
export function AddMusicButton({
  label = '♫ Add music',
  className = 'folder-btn',
  folder: pickFolder = false,
}: {
  label?: string;
  className?: string;
  folder?: boolean;
}) {
  const folder = useMusicFolder();
  const { project } = useStore();
  const isPhone = useIsPhone();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const run = async (files: File[]) => {
    const songs = files.filter((f) => AUDIO_EXTENSIONS.test(f.name));
    const zips = files.filter((f) => /\.zip$/i.test(f.name));
    if (!songs.length && !zips.length) {
      notify('No songs in that. Pick songs (MP3, M4A, WAV, AIFF, FLAC…), a folder of them, or a .zip.', 'error');
      return;
    }
    const total: AddMusicResult = { added: [], notKept: 0 };
    const add = async (batch: File[]) => {
      const res = await folder.addMusic(batch);
      total.added.push(...res.added);
      total.notKept += res.notKept;
      setBusy(total.added.length);
    };
    setBusy(0);
    try {
      for (let i = 0; i < songs.length; i += 25) await add(songs.slice(i, i + 25));
      for (const zip of zips) {
        let batch: File[] = [];
        for await (const song of songsInZip(zip)) {
          batch.push(song);
          if (batch.length === 10) {
            await add(batch);
            batch = [];
          }
        }
        if (batch.length) await add(batch);
      }
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
    if (total.added.length) notify(describeAdded(total, project.library.tracks, isPhone ? 'this phone' : 'this device'));
    else if (zips.length) notify(`No songs found in ${zips[0].name}.`, 'error');
  };

  return (
    <>
      <button
        className={`add-music ${className}`}
        onClick={() => input.current?.click()}
        disabled={busy !== null}
        title={
          pickFolder
            ? 'Pick a folder: every song in it (and its subfolders) is added at once.'
            : 'Pick songs, or a .zip of a whole folder: from this phone, iCloud or a drive plugged in. They stay in Setcraft on this device and are matched to your tracks by name, wherever your DJ software kept them.'
        }
      >
        {busy !== null ? `Adding… ${busy} song${busy === 1 ? '' : 's'}` : label}
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        {...(pickFolder ? ({ webkitdirectory: '' } as Record<string, string>) : { accept: AUDIO_ACCEPT })}
        onChange={(e) => {
          void run(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </>
  );
}

/**
 * Link / reconnect the music folder (on a phone: add music instead).
 * - default: "Link music folder…" / "Change folder…"
 * - compact: hidden once linked (for the cue editor toolbar)
 * - topbar: always visible and shows the linked folder's name
 */
export function LinkFolderButton({ compact = false, topbar = false }: { compact?: boolean; topbar?: boolean }) {
  const folder = useMusicFolder();
  const isPhone = useIsPhone();
  const input = useRef<HTMLInputElement>(null);

  // Phones can't link a folder: songs are added instead, and stay.
  if (isPhone) {
    if (compact && folder.deviceCount) return null;
    return <AddMusicButton className={topbar ? 'folder-btn' : 'folder-btn small'} />;
  }

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
      <button className={`folder-btn ${compact ? 'small' : 'small primary'}`} onClick={() => void folder.reconnect()}>
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
      <button className={`folder-btn ${topbar ? '' : 'small'}`} onClick={pick} title={title}>
        {label}
      </button>
      {fallbackInput}
    </>
  );
}

/** Sidebar panel: folder status plus "analyse the set's waveforms". */
export function MusicFolderPanel() {
  const folder = useMusicFolder();
  const isPhone = useIsPhone();
  const { project, dispatch } = useStore();
  const { audio, rememberedIds, outdatedIds, attach } = useAudio();
  const [progress, setProgress] = useState<{ done: number; total: number; missing: number } | null>(null);

  const set = activeSet(project);
  const setTracks = [...new Set(set.entries.map((e) => e.trackId))]
    .map((id) => project.library.tracks[id])
    .filter(Boolean);
  const hasColour = (id: string) => !!audio[id]?.bands || (rememberedIds.has(id) && !outdatedIds.has(id));
  const withWave = setTracks.filter((t) => hasColour(t.id)).length;
  // Missing, or single-colour from an earlier version: both get (re)analysed.
  const todo = setTracks.filter((t) => !hasColour(t.id));

  const analyseSet = async () => {
    let missing = 0;
    setProgress({ done: 0, total: todo.length, missing });
    for (let i = 0; i < todo.length; i++) {
      const file = await folder.findFile(todo[i]).catch(() => undefined);
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
      <h3>{isPhone ? 'Music' : 'Music folder'}</h3>
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
      {folder.status === 'none' && !isPhone && (
        <p className="muted small-text">Link the folder your music lives in and Setcraft finds each track's audio for waveforms.</p>
      )}
      {isPhone && !folder.deviceCount && (
        <p className="muted small-text">
          Add your songs from the Files app (this phone, iCloud or a drive plugged in). They stay here and are matched
          to your tracks by name. To add everything at once, pick a whole folder, or a .zip of it.
        </p>
      )}
      {folder.status === 'needs-permission' && (
        <p className="muted small-text">Your browser needs a click to open “{folder.folderName}” again.</p>
      )}
      {!isPhone && (
        <div className="row wrap">
          <LinkFolderButton />
          {folder.status === 'ready' && (
            <button className="small danger" onClick={folder.unlink}>
              Unlink
            </button>
          )}
        </div>
      )}
      {folder.deviceCount > 0 && (
        <p className="small-text device-music">
          <b>
            {folder.deviceCount.toLocaleString()} song{folder.deviceCount === 1 ? '' : 's'}
          </b>
          <span className="muted"> on this {isPhone ? 'phone' : 'device'}</span>
        </p>
      )}
      <div className="row wrap">
        <AddMusicButton
          className="small"
          label={isPhone ? (folder.deviceCount ? '♫ Add more songs' : '♫ Add songs') : '♫ Add songs to this device'}
        />
        {isPhone && <AddMusicButton className="small add-folder" folder label="▤ Add a folder" />}
        {folder.deviceCount > 0 && (
          <button
            className="small danger"
            onClick={() => {
              if (confirm(`Remove the ${folder.deviceCount} songs kept on this ${isPhone ? 'phone' : 'device'}? Your tracks and cues stay.`))
                void folder.removeDeviceMusic();
            }}
          >
            Remove
          </button>
        )}
      </div>
      {setTracks.length > 0 && (
        <div className="small-text folder-waves">
          <span className="muted" title={`Colour waveforms for the tracks in “${set.name}”`}>
            Waveforms {withWave}/{setTracks.length} in set
          </span>
          {folder.hasMusic && todo.length > 0 && !progress && (
            <button className="small" onClick={() => void analyseSet()}>
              Analyse {todo.length}
            </button>
          )}
          {progress && (
            <div className="muted">
              {progress.done < progress.total
                ? `Analysing ${progress.done + 1} of ${progress.total}…`
                : `Done.${progress.missing ? ` ${progress.missing} not found in your music.` : ''}`}
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
