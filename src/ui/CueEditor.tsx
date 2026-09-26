import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toCamelot, normaliseKey } from '../core/keys';
import { CUE_COLORS, MAX_HOT_CUES, SLOT_LETTERS, uid, type Cue, type Track } from '../core/model';
import { barBeatLabel, beatLength, formatTime, parseTime, round, snapToBeat } from '../core/time';
import { useAudio } from './audio';
import { activeSet, useStore } from './store';
import { Waveform } from './Waveform';

const LOOP_BEATS = [1, 2, 4, 8, 16, 32];
const ZOOM_BARS = [2, 4, 8, 16, 32];

export function CueEditor({ trackId, onSelectTrack }: { trackId: string | null; onSelectTrack: (id: string) => void }) {
  const { project } = useStore();
  const set = activeSet(project);
  const setTrackIds = set.entries.map((e) => e.trackId).filter((id) => project.library.tracks[id]);
  const effectiveId = trackId && project.library.tracks[trackId] ? trackId : setTrackIds[0] ?? null;
  const track = effectiveId ? project.library.tracks[effectiveId] : undefined;

  return (
    <div className="cue-editor">
      <TrackPicker currentId={effectiveId} setTrackIds={setTrackIds} onSelect={onSelectTrack} />
      {track ? (
        <TrackCueWorkspace key={track.id} track={track} />
      ) : (
        <div className="empty-state small">
          <h2>Pick a track</h2>
          <p>Choose a track from your set or search the library above to plan its hot cues and loops.</p>
        </div>
      )}
    </div>
  );
}

function TrackPicker({
  currentId,
  setTrackIds,
  onSelect,
}: {
  currentId: string | null;
  setTrackIds: string[];
  onSelect: (id: string) => void;
}) {
  const { project } = useStore();
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return Object.values(project.library.tracks)
      .filter((t) => `${t.artist} ${t.title}`.toLowerCase().includes(s))
      .slice(0, 12);
  }, [q, project.library.tracks]);
  const idx = currentId ? setTrackIds.indexOf(currentId) : -1;

  return (
    <div className="track-picker card">
      <label className="inline">
        In this set
        <select value={idx >= 0 ? currentId! : ''} onChange={(e) => e.target.value && onSelect(e.target.value)}>
          <option value="">—</option>
          {setTrackIds.map((id, i) => {
            const t = project.library.tracks[id];
            return (
              <option key={id + i} value={id}>
                {i + 1}. {t.artist} – {t.title}
              </option>
            );
          })}
        </select>
      </label>
      <button className="icon" disabled={idx <= 0} onClick={() => onSelect(setTrackIds[idx - 1])} title="Previous track in set">
        ‹
      </button>
      <button
        className="icon"
        disabled={idx < 0 || idx >= setTrackIds.length - 1}
        onClick={() => onSelect(setTrackIds[idx + 1])}
        title="Next track in set"
      >
        ›
      </button>
      <div className="search-pop">
        <input type="search" placeholder="…or search the whole library" value={q} onChange={(e) => setQ(e.target.value)} />
        {results.length > 0 && (
          <ul className="pop">
            {results.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => {
                    onSelect(t.id);
                    setQ('');
                  }}
                >
                  <b>{t.artist}</b> – {t.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TrackCueWorkspace({ track }: { track: Track }) {
  const { dispatch } = useStore();
  const { audio: attached, loading, attach } = useAudio();
  const audioInfo = attached[track.id];
  const audioEl = useRef<HTMLAudioElement>(null);
  const [playhead, setPlayhead] = useState(track.cues.find((c) => c.slot === 0)?.start ?? track.gridStart ?? 0);
  const [playing, setPlaying] = useState(false);
  const [quantize, setQuantize] = useState(true);
  const [zoomBars, setZoomBars] = useState(8);
  const [hotLoops, setHotLoops] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const duration =
    audioInfo?.duration ?? track.duration ?? Math.max(360, ...track.cues.map((c) => (c.end ?? c.start) + 30));
  const bpm = track.bpm;
  const gridStart = track.gridStart ?? 0;
  const beat = bpm ? beatLength(bpm) : undefined;
  const q = useCallback((s: number) => (quantize ? snapToBeat(s, bpm, gridStart) : s), [quantize, bpm, gridStart]);

  const setCues = useCallback(
    (cues: Cue[]) => dispatch({ type: 'setCues', trackId: track.id, cues }),
    [dispatch, track.id],
  );
  const updateCue = (id: string, patch: Partial<Cue>) =>
    setCues(track.cues.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  // Keep the playhead in sync with the audio element.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      if (audioEl.current) setPlayhead(audioEl.current.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const seek = useCallback(
    (s: number) => {
      const clamped = Math.max(0, Math.min(duration, s));
      setPlayhead(clamped);
      if (audioEl.current) audioEl.current.currentTime = clamped;
    },
    [duration],
  );

  const togglePlay = useCallback(() => {
    const el = audioEl.current;
    if (!el || !audioInfo) return;
    if (el.paused) {
      el.currentTime = playhead;
      void el.play();
    } else el.pause();
  }, [audioInfo, playhead]);

  const hotCues = useMemo(() => {
    const bySlot: (Cue | undefined)[] = Array(MAX_HOT_CUES).fill(undefined);
    for (const c of track.cues) if (c.slot !== null && c.slot < MAX_HOT_CUES) bySlot[c.slot] = c;
    return bySlot;
  }, [track.cues]);

  const firstFreeSlot = () => hotCues.findIndex((c) => !c);

  const addCue = useCallback(
    (cue: Omit<Cue, 'id'>) => {
      const c = { ...cue, id: uid('cue') };
      setCues([...track.cues.filter((x) => cue.slot === null || x.slot !== cue.slot), c]);
      setSelectedId(c.id);
    },
    [setCues, track.cues],
  );

  const pad = useCallback(
    (slot: number) => {
      const existing = hotCues[slot];
      if (existing) {
        setSelectedId(existing.id);
        seek(existing.start);
        return;
      }
      addCue({ kind: 'cue', slot, start: round(q(playhead), 3), name: '', color: CUE_COLORS[slot] });
    },
    [hotCues, seek, addCue, q, playhead],
  );

  const addLoop = (beats: number) => {
    if (!beat) return;
    const start = round(q(playhead), 3);
    const slot = hotLoops ? firstFreeSlot() : -1;
    addCue({
      kind: 'loop',
      slot: slot >= 0 ? slot : null,
      start,
      end: round(start + beats * beat, 3),
      name: `${beats} beat loop`,
      color: slot >= 0 ? CUE_COLORS[slot] : CUE_COLORS[1],
    });
  };

  const addMemory = () =>
    addCue({ kind: 'cue', slot: null, start: round(q(playhead), 3), name: '', color: CUE_COLORS[0] });

  // Keyboard: space play, 1-8 pads, M memory cue, Q quantize, ←/→ one beat (shift: one bar).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (/^Digit[1-8]$/.test(e.code)) {
        pad(Number(e.code.slice(5)) - 1);
      } else if (e.key === 'm' || e.key === 'M') addMemory();
      else if (e.key === 'q' || e.key === 'Q') setQuantize((v) => !v);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const step = (beat ?? 0.5) * (e.shiftKey ? 4 : 1) * (e.key === 'ArrowLeft' ? -1 : 1);
        seek(q(playhead + step));
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        setCues(track.cues.filter((c) => c.id !== selectedId));
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const selected = track.cues.find((c) => c.id === selectedId);
  const sortedCues = [...track.cues].sort((a, b) => a.start - b.start);

  const onAttach = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const info = await attach(track.id, file);
      if (!track.duration) dispatch({ type: 'updateTrack', id: track.id, patch: { duration: info.duration } });
    } catch {
      setError(`Your browser couldn't decode "${file.name}". Try an MP3, WAV, AIFF or FLAC.`);
    }
  };

  return (
    <div className="workspace">
      <section className="card track-head">
        <div className="track-title">
          <h2>{track.title}</h2>
          <div className="muted">{track.artist}</div>
        </div>
        <TrackFields track={track} />
      </section>

      <section className="card deck">
        <div className="deck-bar">
          <button className="primary" onClick={togglePlay} disabled={!audioInfo} title="Space">
            {playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          <span className="clock">
            {formatTime(playhead)}
            {bpm && <span className="muted"> · bar {barBeatLabel(playhead, bpm, gridStart)}</span>}
          </span>
          <button className="small" onClick={() => seek(q(playhead - (beat ?? 0.5) * 4))} title="Back one bar (Shift+←)">
            −1 bar
          </button>
          <button className="small" onClick={() => seek(q(playhead + (beat ?? 0.5) * 4))} title="Forward one bar (Shift+→)">
            +1 bar
          </button>
          <label className="inline toggle" title="Snap cues to the beat grid (Q)">
            <input type="checkbox" checked={quantize} onChange={(e) => setQuantize(e.target.checked)} disabled={!bpm} />
            Quantize
          </label>
          <label className="inline">
            Zoom
            <select value={zoomBars} onChange={(e) => setZoomBars(Number(e.target.value))}>
              {ZOOM_BARS.map((b) => (
                <option key={b} value={b}>
                  {b} bars
                </option>
              ))}
            </select>
          </label>
          <span className="grow" />
          {loading[track.id] ? (
            <span className="muted">Analysing audio…</span>
          ) : (
            <button className="small" onClick={() => fileInput.current?.click()}>
              {audioInfo ? `♫ ${audioInfo.fileName}` : 'Attach audio file…'}
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="audio/*"
            hidden
            onChange={(e) => {
              void onAttach(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
        {error && <div className="error-line">{error}</div>}
        {!bpm && (
          <div className="hint-line">
            This track has no BPM yet. Enter one above to get quantizing, bar numbers and beat-length loops.
          </div>
        )}
        <Waveform
          duration={duration}
          peaks={audioInfo?.peaks}
          peaksPerSecond={audioInfo?.peaksPerSecond}
          cues={track.cues}
          playhead={playhead}
          bpm={bpm}
          gridStart={gridStart}
          selectedCueId={selectedId}
          windowSeconds={beat ? zoomBars * 4 * beat : zoomBars * 2}
          height={150}
          onSeek={(s) => seek(q(s))}
          onSelectCue={(id) => {
            setSelectedId(id);
          }}
          onMoveCue={(id, s) => {
            const c = track.cues.find((x) => x.id === id);
            if (!c) return;
            const start = round(q(s), 3);
            const len = c.end !== undefined ? c.end - c.start : undefined;
            updateCue(id, { start, end: len !== undefined ? round(start + len, 3) : undefined });
          }}
        />
        <Waveform
          duration={duration}
          peaks={audioInfo?.peaks}
          peaksPerSecond={audioInfo?.peaksPerSecond}
          cues={track.cues}
          playhead={playhead}
          selectedCueId={selectedId}
          height={56}
          onSeek={seek}
          onSelectCue={(id) => {
            setSelectedId(id);
            const c = track.cues.find((x) => x.id === id);
            if (c) seek(c.start);
          }}
        />
        {audioInfo && (
          <audio
            ref={audioEl}
            src={audioInfo.url}
            onPlay={() => setPlaying(true)}
            onPause={() => {
              setPlaying(false);
              if (audioEl.current) setPlayhead(audioEl.current.currentTime);
            }}
            onEnded={() => setPlaying(false)}
          />
        )}
      </section>

      <div className="cue-columns">
        <section className="card">
          <div className="card-head">
            <h3>Hot cues</h3>
            <span className="muted">Empty pad: set at playhead · filled pad: jump · keys 1–8</span>
          </div>
          <div className="pads">
            {hotCues.map((c, slot) => (
              <button
                key={slot}
                className={`pad ${c ? 'filled' : ''} ${c && c.id === selectedId ? 'selected' : ''}`}
                style={c ? { background: c.color, borderColor: c.color } : undefined}
                onClick={() => pad(slot)}
              >
                <span className="pad-letter">{SLOT_LETTERS[slot]}</span>
                {c ? (
                  <>
                    <span className="pad-name">{c.name || (c.kind === 'loop' ? 'Loop' : 'Cue')}</span>
                    <span className="pad-time">
                      {c.kind === 'loop' ? '↻ ' : ''}
                      {bpm ? barBeatLabel(c.start, bpm, gridStart) : formatTime(c.start, false)}
                    </span>
                  </>
                ) : (
                  <span className="pad-empty">set</span>
                )}
              </button>
            ))}
          </div>
          <div className="row wrap">
            <span className="muted">Loop at playhead:</span>
            {LOOP_BEATS.map((b) => (
              <button key={b} className="small" disabled={!beat} onClick={() => addLoop(b)} title={beat ? '' : 'Needs a BPM'}>
                {b < 4 ? `${b} beat${b > 1 ? 's' : ''}` : `${b / 4} bar${b > 4 ? 's' : ''}`}
              </button>
            ))}
            <label className="inline toggle">
              <input type="checkbox" checked={hotLoops} onChange={(e) => setHotLoops(e.target.checked)} />
              on a pad
            </label>
          </div>
          <div className="row">
            <button className="small" onClick={addMemory} title="M">
              + Memory cue at playhead
            </button>
            <button
              className="small danger"
              disabled={!track.cues.length}
              onClick={() => confirm('Delete all cues and loops on this track?') && setCues([])}
            >
              Clear all
            </button>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h3>{selected ? 'Edit cue' : 'All cues & loops'}</h3>
            {selected && (
              <button className="small" onClick={() => setSelectedId(null)}>
                Show all
              </button>
            )}
          </div>
          {selected ? (
            <CueForm
              cue={selected}
              beat={beat}
              occupied={hotCues.map((c) => (c && c.id !== selected.id ? c : undefined))}
              onChange={(patch) => updateCue(selected.id, patch)}
              onSlotChange={(slot) =>
                setCues(
                  track.cues
                    .filter((c) => slot === null || c.id === selected.id || c.slot !== slot)
                    .map((c) =>
                      c.id === selected.id
                        ? { ...c, slot, color: slot !== null && c.slot === null ? CUE_COLORS[slot] : c.color }
                        : c,
                    ),
                )
              }
              onDelete={() => {
                setCues(track.cues.filter((c) => c.id !== selected.id));
                setSelectedId(null);
              }}
              onJump={() => seek(selected.start)}
              onSetToPlayhead={() => {
                const start = round(q(playhead), 3);
                const len = selected.end !== undefined ? selected.end - selected.start : undefined;
                updateCue(selected.id, { start, end: len !== undefined ? round(start + len, 3) : undefined });
              }}
            />
          ) : sortedCues.length ? (
            <table className="cue-table">
              <tbody>
                {sortedCues.map((c) => (
                  <tr key={c.id} onClick={() => setSelectedId(c.id)}>
                    <td>
                      <span className="swatch" style={{ background: c.color }} />
                      {c.slot !== null ? SLOT_LETTERS[c.slot] : 'Mem'}
                    </td>
                    <td>{c.kind === 'loop' ? 'Loop' : 'Cue'}</td>
                    <td className="num">{formatTime(c.start)}</td>
                    <td className="num muted">{bpm ? barBeatLabel(c.start, bpm, gridStart) : ''}</td>
                    <td>{c.name}</td>
                    <td className="muted origin" title={c.edited ? 'Edited in Setcraft: wins when merging imports' : `From ${c.origin ?? 'unknown'}`}>
                      <span className={`src-dot src-${c.origin ?? 'manual'}`} />
                      {c.origin === 'manual' ? 'setcraft' : (c.origin ?? '')}
                      {c.edited ? ' · edited' : ''}
                    </td>
                    <td className="num muted">
                      {c.kind === 'loop' && c.end !== undefined && beat ? `${round((c.end - c.start) / beat, 2)} beats` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">No cues yet. Set pads, loops or memory cues on the left.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function CueForm({
  cue,
  beat,
  occupied,
  onChange,
  onSlotChange,
  onDelete,
  onJump,
  onSetToPlayhead,
}: {
  cue: Cue;
  beat: number | undefined;
  occupied: (Cue | undefined)[];
  onChange: (patch: Partial<Cue>) => void;
  onSlotChange: (slot: number | null) => void;
  onDelete: () => void;
  onJump: () => void;
  onSetToPlayhead: () => void;
}) {
  const [startText, setStartText] = useState(formatTime(cue.start));
  useEffect(() => setStartText(formatTime(cue.start)), [cue.start]);
  const loopBeats = cue.end !== undefined && beat ? round((cue.end - cue.start) / beat, 3) : undefined;

  const nudge = (sec: number) => {
    const start = round(Math.max(0, cue.start + sec), 3);
    onChange({ start, end: cue.end !== undefined ? round(cue.end + (start - cue.start), 3) : undefined });
  };

  return (
    <div className="cue-form">
      <div className="row">
        <label className="grow">
          Name
          <input value={cue.name} placeholder="e.g. Vocal in, Drop, Outro" onChange={(e) => onChange({ name: e.target.value })} autoFocus />
        </label>
        <label>
          Pad
          <select value={cue.slot ?? ''} onChange={(e) => onSlotChange(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">Memory</option>
            {SLOT_LETTERS.map((l, i) => (
              <option key={l} value={i}>
                {l}
                {occupied[i] ? ' (replace)' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row">
        <label>
          Start
          <input
            value={startText}
            onChange={(e) => setStartText(e.target.value)}
            onBlur={() => {
              const s = parseTime(startText);
              if (s !== undefined) nudge(s - cue.start);
              else setStartText(formatTime(cue.start));
            }}
          />
        </label>
        {cue.kind === 'loop' && (
          <label>
            Length (beats)
            <input
              type="number"
              min={0.03125}
              step="any"
              value={loopBeats ?? ''}
              disabled={!beat}
              onChange={(e) => {
                const b = Number(e.target.value);
                if (beat && b > 0) onChange({ end: round(cue.start + b * beat, 3) });
              }}
            />
          </label>
        )}
        <label>
          Type
          <select
            value={cue.kind}
            onChange={(e) =>
              e.target.value === 'loop'
                ? onChange({ kind: 'loop', end: round(cue.start + (beat ?? 0.5) * 16, 3) })
                : onChange({ kind: 'cue', end: undefined })
            }
          >
            <option value="cue">Cue</option>
            <option value="loop">Loop</option>
          </select>
        </label>
      </div>
      <div className="row wrap">
        <span className="muted">Nudge</span>
        {beat && (
          <>
            <button className="small" onClick={() => nudge(-beat * 4)}>−bar</button>
            <button className="small" onClick={() => nudge(-beat)}>−beat</button>
          </>
        )}
        <button className="small" onClick={() => nudge(-0.01)}>−10ms</button>
        <button className="small" onClick={() => nudge(0.01)}>+10ms</button>
        {beat && (
          <>
            <button className="small" onClick={() => nudge(beat)}>+beat</button>
            <button className="small" onClick={() => nudge(beat * 4)}>+bar</button>
          </>
        )}
      </div>
      <div className="row wrap">
        <span className="muted">Colour</span>
        {CUE_COLORS.map((c) => (
          <button
            key={c}
            className={`swatch-btn ${cue.color === c ? 'active' : ''}`}
            style={{ background: c }}
            onClick={() => onChange({ color: c })}
            aria-label={`Colour ${c}`}
          />
        ))}
        <input type="color" value={cue.color} onChange={(e) => onChange({ color: e.target.value })} aria-label="Custom colour" />
      </div>
      <div className="row">
        <button className="small" onClick={onJump}>Jump to</button>
        <button className="small" onClick={onSetToPlayhead}>Move to playhead</button>
        <span className="grow" />
        <button className="small danger" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}

function TrackFields({ track }: { track: Track }) {
  const { dispatch } = useStore();
  const update = (patch: Partial<Track>) => dispatch({ type: 'updateTrack', id: track.id, patch });
  const [bpmText, setBpmText] = useState(track.bpm?.toString() ?? '');
  const [keyText, setKeyText] = useState(track.key ?? '');
  const [gridText, setGridText] = useState(track.gridStart !== undefined ? formatTime(track.gridStart) : '');

  return (
    <div className="track-fields">
      <label>
        BPM
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
