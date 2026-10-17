import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { keyColor, toCamelot } from '../core/keys';
import type { Cue, Track } from '../core/model';
import { barBeatLabel, formatTime } from '../core/time';
import { FX_BEATS, type OutFx } from './deck';
import { Knob } from './Knob';
import { useNight, useNightState } from './night';
import { NightNow, SourceSwitch } from './NightBar';
import { PlayIcon } from './PlayIcon';

/**
 * The player bar along the bottom of the app: what's playing (the deck's track
 * or the night), the transport, the out FX and the volume. The deck hands it
 * its state and actions; on the night, it drives the night player itself.
 */
export function PlayerBar(p: {
  track: Track;
  playhead: number;
  activeLoop?: Cue;
  onExitLoop: () => void;
  onBarBack: () => void;
  onBarForward: () => void;
  playing: boolean;
  deckReady: boolean;
  onTogglePlay: () => void;
  fxActive: OutFx | null;
  onFx: (kind: OutFx) => void;
  fxBeats: number;
  onFxBeats: (beats: number) => void;
  fxMix: number;
  onFxMix: (mix: number) => void;
  playOn: boolean;
  onPlayOn: () => void;
  /** The next track in the night, for "▸ Next". */
  next?: { title: string; at: number };
  volume: number;
  onVolume: (v: number) => void;
  meterRef: RefObject<HTMLSpanElement | null>;
}) {
  const night = useNight();
  const nightState = useNightState();
  return createPortal(
    // The player bar floats along the bottom of the whole app.
    <div className="transport-bar" role="region" aria-label="Player">
      <div className="tb-left">
        <SourceSwitch />
        {nightState.active ? (
          <NightNow />
        ) : (
          <>
        <div className="tb-track">
          <b>{p.track.title}</b>
          <span>
            {p.track.artist}
            {p.track.key && (
              <i className="key-pill" style={{ background: keyColor(p.track.key) }}>
                {toCamelot(p.track.key)}
              </i>
            )}
          </span>
        </div>
        <span className="clock">
          {formatTime(p.playhead)}
          {p.track.bpm && <span className="muted"> · bar {barBeatLabel(p.playhead, p.track.bpm, p.track.gridStart ?? 0)}</span>}
        </span>
        {p.activeLoop && (
          <button className="small looping-btn" onClick={p.onExitLoop} title="Release the loop and play on">
            ↻ {p.activeLoop.name || 'Loop'} · exit
          </button>
        )}
          </>
        )}
      </div>
      <div className="transport">
        {nightState.active ? (
          <button className="small" onClick={() => night.jumpMix(-1)} title="To just before the previous mix">
            ◂ Mix
          </button>
        ) : (
          <button className="small" onClick={p.onBarBack} title="Back one bar (Shift+←)">
            −1 bar
          </button>
        )}
        {(() => {
          const on = nightState.active ? nightState.playing : p.playing;
          return (
            <button
              className={`play-btn ${on ? 'playing' : ''}`}
              onClick={p.onTogglePlay}
              disabled={!nightState.active && !p.deckReady}
              title={on ? 'Pause (Space)' : 'Play (Space)'}
              aria-label={on ? 'Pause' : 'Play'}
            >
              <PlayIcon playing={on} />
            </button>
          );
        })()}
        {nightState.active ? (
          <button className="small" onClick={() => night.jumpMix(1)} title="To just before the next mix">
            Mix ▸
          </button>
        ) : (
          <button className="small" onClick={p.onBarForward} title="Forward one bar (Shift+→)">
            +1 bar
          </button>
        )}
      </div>
      <div className="tb-right">
        <div className="snap-control fx-group" role="group" aria-label="Out effects">
          <span className="snap-label">FX</span>
          {(
            [
              ['echo', 'Echo', 'E', 'Echo out: beat-synced echoes; the track cuts on the first echo and the echoes fade'],
              ['reverb', 'Reverb', 'R', 'Reverb out: the track swells into a big reverb, cuts, and the reverb rings out'],
              ['loop', 'Loop', 'L', 'Loop out: the next beats repeat as a loop roll that fades over two bars while a filter sweeps up'],
              ['spin', 'Spin', 'B', 'Backspin: whips the record backwards and winds it down'],
            ] as [OutFx, string, string, string][]
          ).map(([kind, label, key, hint]) => (
            <button
              key={kind}
              className={p.fxActive === kind ? 'on' : ''}
              disabled={!p.deckReady}
              onClick={() => p.onFx(kind)}
              title={`${hint}. Key ${key}. Stopped? It plays a bar from the playhead first.`}
            >
              {label}
            </button>
          ))}
          <select
            className="fx-beats"
            value={p.fxBeats}
            onChange={(e) => p.onFxBeats(Number(e.target.value))}
            aria-label="FX beats"
            title="Beats: the echo time, how long the reverb swells, the loop length, or how long the backspin lasts"
          >
            {FX_BEATS.map((b) => (
              <option key={b} value={b}>
                {b === 0.25 ? '1/4' : b === 0.5 ? '1/2' : b === 0.75 ? '3/4' : b} {b > 1 ? 'beats' : 'beat'}
              </option>
            ))}
          </select>
          <Knob
            value={p.fxMix}
            onChange={p.onFxMix}
            label="D/W"
            title="Dry/wet: left mostly the track, middle both, right only the effect (on the loop out, how far the filter sweeps)"
          />
          <button
            className={`then-next ${p.playOn ? 'on' : ''}`}
            aria-pressed={p.playOn}
            onClick={p.onPlayOn}
            title={
              p.next
                ? `Then play on into the next track of the night, “${p.next.title}”, from ${formatTime(p.next.at, false)}, while the FX tail rings (also when a track ends). ${p.playOn ? 'On' : 'Off'}.`
                : 'Then play on into the next track of the night (this track has none after it in the set).'
            }
          >
            ▸ Next
          </button>
        </div>
        <label className="inline volume" title="Preview volume · the bar shows the level going to your speakers">
          Vol
          <span className="level-meter" ref={p.meterRef} aria-hidden />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={p.volume}
            onChange={(e) => p.onVolume(Number(e.target.value))}
            aria-label="Volume"
          />
        </label>
      </div>
    </div>,
    document.body,
  );
}
