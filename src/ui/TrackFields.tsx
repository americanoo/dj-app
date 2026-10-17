import { useEffect, useState } from 'react';
import { toCamelot, normaliseKey } from '../core/keys';
import { withTimes } from '../core/setplan';
import { scaleTempo } from '../core/tempo';
import { type Track } from '../core/model';
import { formatTime, parseTime } from '../core/time';
import { activeSet, useStore } from './store';

/** ‹ › to step to the previous / next track in the night. */
export function NightStepper({ trackId, onSelectTrack }: { trackId: string; onSelectTrack: (id: string) => void }) {
  const { project } = useStore();
  const ids = withTimes(activeSet(project), project.library)
    .entries.map((e) => e.trackId)
    .filter((id) => project.library.tracks[id]);
  const idx = ids.indexOf(trackId);
  return (
    <div className="night-stepper">
      <button className="icon" disabled={idx <= 0} onClick={() => onSelectTrack(ids[idx - 1])} title="Previous track in the night">
        ‹
      </button>
      <span className="muted small-text">{idx >= 0 ? `${idx + 1}/${ids.length}` : 'not in set'}</span>
      <button
        className="icon"
        disabled={idx < 0 || idx >= ids.length - 1}
        onClick={() => onSelectTrack(ids[idx + 1])}
        title="Next track in the night"
      >
        ›
      </button>
    </div>
  );
}

export function TrackFields({ track }: { track: Track }) {
  const { dispatch } = useStore();
  const update = (patch: Partial<Track>) => dispatch({ type: 'updateTrack', id: track.id, patch });
  const [bpmText, setBpmText] = useState(track.bpm?.toString() ?? '');
  useEffect(() => setBpmText(track.bpm?.toString() ?? ''), [track.bpm]);
  const [keyText, setKeyText] = useState(track.key ?? '');
  const [gridText, setGridText] = useState(track.gridStart !== undefined ? formatTime(track.gridStart) : '');

  return (
    <div className="track-fields">
      <label>
        <span className="bpm-label">
          BPM
          <button
            className="tempo-btn"
            disabled={!track.bpm}
            onClick={() => update(scaleTempo(track, 0.5))}
            title="Halve the BPM (fix a double-time reading, e.g. 192 → 96)"
          >
            ×½
          </button>
          <button
            className="tempo-btn"
            disabled={!track.bpm}
            onClick={() => update(scaleTempo(track, 2))}
            title="Double the BPM (fix a half-time reading, e.g. 87 → 174)"
          >
            ×2
          </button>
        </span>
        <input
          value={bpmText}
          inputMode="decimal"
          onChange={(e) => setBpmText(e.target.value)}
          onBlur={() => {
            const n = Number(bpmText);
            const bpm = n > 0 ? n : undefined;
            // A hand-edited tempo replaces any imported variable-tempo grid.
            if (bpm !== track.bpm) update({ bpm, beatGrid: undefined });
          }}
        />
      </label>
      <label>
        <span>
          Key {track.key && <span className="muted">· {toCamelot(track.key)}</span>}
        </span>
        <input value={keyText} onChange={(e) => setKeyText(e.target.value)} onBlur={() => update({ key: normaliseKey(keyText.trim()) })} />
      </label>
      <label title="Position of the first downbeat (bar 1, beat 1)">
        Grid start
        <input
          value={gridText}
          placeholder="0:00.000"
          onChange={(e) => setGridText(e.target.value)}
          onBlur={() => {
            const gridStart = parseTime(gridText);
            const unchanged =
              gridStart !== undefined && track.gridStart !== undefined && Math.abs(gridStart - track.gridStart) < 0.0005;
            if (!unchanged && gridStart !== track.gridStart) update({ gridStart, beatGrid: undefined });
          }}
        />
      </label>
      <label className="grow" title="Absolute path of the audio file on the computer running your DJ software">
        File location
        <input
          value={track.path ?? ''}
          placeholder="/Users/you/Music/Artist - Title.mp3"
          onChange={(e) => update({ path: e.target.value || undefined })}
        />
      </label>
    </div>
  );
}
