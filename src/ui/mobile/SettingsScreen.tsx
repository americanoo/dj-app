import type { ReactNode } from 'react';
import { LinkFolderButton } from '../MusicFolderControl';
import { useKeyLock } from '../night';
import { activeSet, useStore } from '../store';
import { notify } from '../toastBus';

export interface SettingsActions {
  story: () => void;
  exportNight: () => void;
  versions: () => void;
  controller: () => void;
  founding: () => void;
  clearLibrary: () => void;
  importFiles: () => void;
  /** The Mac app's music folders, when there. */
  musicFolders?: () => void;
  install?: () => void;
  classic: () => void;
  foundingLabel: string;
  controllerHint: string;
}

/** Everything else: music, the night's start time, export, key lock, versions. */
export function SettingsScreen({ header, actions: a }: { header: ReactNode; actions: SettingsActions }) {
  const { project, dispatch } = useStore();
  const set = activeSet(project);
  const keyLock = useKeyLock();
  return (
    <div className="m-screen m-settings">
      {header}
      <div className="m-scroll m-list">
        <h3>music</h3>
        <Row label="import" hint="Traktor NML, rekordbox XML, Serato, M3U or audio files" onClick={a.importFiles} />
        {a.musicFolders ? <Row label="music folders" hint="where your songs are on this Mac" onClick={a.musicFolders} /> : <div className="m-row-item m-link-row"><LinkFolderButton /></div>}
        <h3>the night</h3>
        <label className="m-row-item">
          <span>
            name
            <small>shown at the top of the playlist</small>
          </span>
          <input className="m-input" defaultValue={set.name} key={set.id + set.name} onBlur={(e) => e.target.value.trim() && e.target.value !== set.name && dispatch({ type: 'updateSet', patch: { name: e.target.value.trim() } })} />
        </label>
        <label className="m-row-item">
          <span>
            start time
            <small>the rulers show real times</small>
          </span>
          <input className="m-input" type="time" value={set.startClock ?? ''} onChange={(e) => dispatch({ type: 'updateSet', patch: { startClock: e.target.value || undefined } })} aria-label="start time" />
        </label>
        <div className="m-row-item">
          <span>
            blend every transition
            <small>each track comes in over the end of the one before</small>
          </span>
          <span className="m-blend">
            {[8, 16, 32].map((bars) => (
              <button
                key={bars}
                className="m-chip"
                aria-label={`blend every transition over ${bars} bars`}
                disabled={set.entries.length < 2}
                onClick={() => {
                  dispatch({ type: 'blendNight', bars });
                  notify(`Every transition now blends over ${bars} bars.`, 'info', { label: 'Undo', run: () => dispatch({ type: 'undo' }) });
                }}
              >
                {bars}
              </button>
            ))}
          </span>
        </div>
        <Row label="story & chapters" hint="venue, chapters, notes" onClick={a.story} />
        <label className="m-row-item">
          <span>
            key lock
            <small>{keyLock.available ? 'tempo changes keep the pitch' : 'needs the installed app or https'}</small>
          </span>
          <input type="checkbox" className="m-switch" checked={keyLock.on} disabled={!keyLock.available} onChange={(e) => keyLock.set(e.target.checked)} aria-label="key lock" />
        </label>
        <h3>share</h3>
        <Row label="export" hint="back to Traktor, rekordbox, Serato, djay Pro or M3U" onClick={a.exportNight} />
        <Row label="versions" hint="save and restore" onClick={a.versions} />
        <Row label="controller" hint={a.controllerHint} onClick={a.controller} />
        {a.install && <Row label="install app" hint="home screen, works offline" onClick={a.install} />}
        <h3>more</h3>
        <Row label="classic layout" hint="the full editor: deck, transitions, timeline" onClick={a.classic} />
        <Row label={a.foundingLabel} hint="support Setcraft" onClick={a.founding} />
        <Row label="clear library…" hint="start over; a version is saved first" onClick={a.clearLibrary} danger />
        <p className="m-build">build {__BUILD__}</p>
      </div>
    </div>
  );
}

function Row({ label, hint, onClick, danger = false }: { label: string; hint: string; onClick: () => void; danger?: boolean }) {
  return (
    <button className={`m-row-item${danger ? ' danger' : ''}`} onClick={onClick}>
      <span>
        {label}
        <small>{hint}</small>
      </span>
      <span className="m-chev" aria-hidden="true">
        ›
      </span>
    </button>
  );
}
