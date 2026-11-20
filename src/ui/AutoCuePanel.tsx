import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { planAutoCues, type AutoCueMode } from '../core/autocues';
import { SLOT_LETTERS, uid, type Cue, type Track } from '../core/model';
import { detectSections, phraseChanges, type PhraseChange, type Section } from '../core/sections';
import type { WaveformData } from '../core/waveform';
import { barBeatLabel, formatTime } from '../core/time';
import { useAudio } from './audio';
import { PadStrip } from './MergeReview';
import { activeSet, useStore } from './store';
import { useVersions } from './versions';
import { SECTION_COLORS } from './Waveform';

const SETTINGS_KEY = 'setcraft-autocues';

function loadSettings(): { mode: AutoCueMode; mixLoops: boolean } {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '');
    if (['fill', 'replace', 'memory'].includes(s.mode)) return { mode: s.mode, mixLoops: !!s.mixLoops };
  } catch {
    // first time
  }
  return { mode: 'fill', mixLoops: true };
}

const MODES: { id: AutoCueMode; label: string; hint: string }[] = [
  { id: 'fill', label: 'Fill empty pads', hint: 'Your cues stay where they are; auto cues go on the free pads.' },
  { id: 'replace', label: 'Replace pads', hint: 'Auto cues take all eight pads; your hot cues are kept as memory cues.' },
  { id: 'memory', label: 'Memory cues', hint: 'Adds memory cues at the sections and leaves the pads alone.' },
];

/**
 * Suggests cue points from the detected song sections, previews them on the
 * pads, and applies them to this track or to every track in the set.
 */
export function AutoCuePanel({
  track,
  sections,
  wave,
  onApply,
  onClose,
}: {
  track: Track;
  sections: Section[];
  /** The track's colour waveform, for finding phrase changes inside long sections. */
  wave?: WaveformData;
  onApply: (cues: Cue[]) => void;
  onClose: () => void;
}) {
  const { project, dispatch } = useStore();
  const { getWaveform } = useAudio();
  const { save } = useVersions();
  const [settings, setSettings] = useState(loadSettings);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const update = (patch: Partial<typeof settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // private mode
    }
  };

  const changesOf = (t: Track, w?: WaveformData): PhraseChange[] =>
    w?.bands ? phraseChanges(w.bands, w.peaksPerSecond, w.duration, t.bpm, t.gridStart) : [];
  const options = (t: Track, fillers: PhraseChange[]) => ({
    ...settings,
    bpm: t.bpm,
    gridStart: t.gridStart,
    colorOf: (k: keyof typeof SECTION_COLORS) => SECTION_COLORS[k],
    newId: () => uid('cue'),
    fillers,
  });
  const fillers = useMemo(
    () => changesOf(track, wave),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wave, track.bpm, track.gridStart],
  );
  const plan = useMemo(
    () => planAutoCues(track.cues, sections, options(track, fillers)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [track, sections, settings, fillers],
  );
  const takenPads = track.cues.filter((c) => c.slot !== null).length;

  const set = activeSet(project);
  const setTrackIds = [...new Set(set.entries.map((e) => e.trackId))].filter((id) => project.library.tracks[id]);

  const applyToSet = async () => {
    setBusy(true);
    try {
      const patches: Record<string, Partial<Track>> = {};
      let cues = 0;
      let noWave = 0;
      for (const id of setTrackIds) {
        const t = project.library.tracks[id];
        const w = id === track.id ? wave : await getWaveform(id);
        const secs =
          id === track.id
            ? sections
            : w?.bands
              ? detectSections(w.bands, w.peaksPerSecond, w.duration, t.bpm, t.gridStart)
              : [];
        if (!secs.length) {
          noWave++;
          continue;
        }
        const p = planAutoCues(t.cues, secs, options(t, id === track.id ? fillers : changesOf(t, w)));
        if (!p.added.length) continue;
        patches[id] = { cues: p.cues };
        cues += p.added.length;
      }
      const n = Object.keys(patches).length;
      if (n) {
        await save(project, `Before auto cues on ${n} track${n === 1 ? '' : 's'}`, true).catch(() => undefined);
        dispatch({ type: 'updateTracks', patches });
      }
      setResult(
        (n ? `Added ${cues} cue${cues === 1 ? '' : 's'} to ${n} track${n === 1 ? '' : 's'}.` : 'No new cues to add.') +
          (noWave
            ? ` ${noWave} track${noWave === 1 ? ' has' : 's have'} no colour waveform yet: use “Analyse” under Music folder in the library, then run this again.`
            : '') +
          (n ? ' ⌘Z undoes it.' : ''),
      );
    } finally {
      setBusy(false);
    }
  };

  const mode = MODES.find((m) => m.id === settings.mode)!;
  const slotLabel = (c: Cue) => (c.kind === 'loop' ? 'Loop' : c.slot !== null ? SLOT_LETTERS[c.slot] : 'Mem');

  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Auto cues" onClick={onClose}>
      <div className="modal auto-cues" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Auto cues</h2>
          <p>
            Cue points from the song's sections: the first downbeat, the drop, breakdowns, the build and the outro.
            They land on the beat grid, named and coloured by section.
          </p>
        </header>
        <div className="modal-body">
          <div className="auto-options">
            <div className="snap-control" role="radiogroup" aria-label="Where to put them">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  role="radio"
                  aria-checked={settings.mode === m.id}
                  className={settings.mode === m.id ? 'on' : ''}
                  onClick={() => update({ mode: m.id })}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <label className="inline toggle">
              <input type="checkbox" checked={settings.mixLoops} onChange={(e) => update({ mixLoops: e.target.checked })} />
              4-bar mix loops at the intro and outro
            </label>
          </div>
          <p className="muted small-text">{mode.hint}</p>
          {settings.mode === 'fill' && takenPads > 0 && (
            <p className="auto-hint">
              {takenPads} of 8 pads already have your cues, so only {8 - takenPads} can be filled.{' '}
              <button className="link" onClick={() => update({ mode: 'replace' })}>
                Let auto cues pick all 8
              </button>{' '}
              (your cues are kept as memory cues).
            </p>
          )}

          <div className="auto-preview">
            <PadStrip label="Now" cues={track.cues} />
            <PadStrip label="After" cues={plan.cues} highlight />
          </div>

          {plan.added.length ? (
            <table className="cue-table auto-list">
              <tbody>
                {[...plan.added]
                  .sort((a, b) => a.start - b.start)
                  .map((c) => (
                    <tr key={c.id}>
                      <td>
                        <span className="swatch" style={{ background: c.color }} />
                        {slotLabel(c)}
                      </td>
                      <td>{c.name}</td>
                      <td className="num">{formatTime(c.start)}</td>
                      <td className="num muted">{track.bpm ? `bar ${barBeatLabel(c.start, track.bpm, track.gridStart)}` : ''}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">
              {settings.mode === 'fill' && track.cues.filter((c) => c.slot !== null).length >= 8
                ? 'All eight pads are taken. Choose “Replace pads” or “Memory cues”.'
                : 'Nothing new to add: these points are already cued.'}
            </p>
          )}
          {plan.demoted > 0 && (
            <p className="muted small-text">
              Your {plan.demoted} hot cue{plan.demoted === 1 ? '' : 's'} will be kept as memory cue{plan.demoted === 1 ? '' : 's'}.
            </p>
          )}
          {result && <p className="auto-result">{result}</p>}
        </div>
        <footer className="modal-foot">
          <span className="muted grow">⌘Z undoes it.</span>
          <button onClick={onClose}>{result ? 'Close' : 'Cancel'}</button>
          {setTrackIds.length > 1 && (
            <button disabled={busy} onClick={() => void applyToSet()} title="Same settings, every track in the set that has a colour waveform">
              {busy ? 'Working…' : `Apply to all ${setTrackIds.length} tracks in the set`}
            </button>
          )}
          <button
            className="primary"
            disabled={!plan.added.length && !plan.demoted}
            onClick={() => {
              onApply(plan.cues);
              onClose();
            }}
          >
            Add {plan.added.length} cue{plan.added.length === 1 ? '' : 's'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
