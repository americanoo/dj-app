import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { keyColor, toCamelot, normaliseKey } from '../core/keys';
import { withTimes } from '../core/setplan';
import { scaleTempo } from '../core/tempo';
import { CUE_COLORS, MAX_HOT_CUES, SLOT_LETTERS, uid, type Cue, type Project, type Track } from '../core/model';
import { barBeatLabel, beatLength, formatTime, parseTime, round, SNAP_MODES, snapTime, type SnapMode } from '../core/time';
import { audioContext, useAudio } from './audio';
import { Deck } from './deck';
import { moveCueToSlot } from '../core/cues';
import { useMusicFolder } from './musicFolder';
import { useFitZoom } from './fit';
import { AutoCuePanel } from './AutoCuePanel';
import { LinkFolderButton } from './MusicFolderControl';
import { activeSet, useStore } from './store';
import { SECTION_COLORS, Waveform } from './Waveform';
import { detectSections, SECTION_LABELS } from '../core/sections';
import { PadStrip } from './MergeReview';
import { formatWhen, useVersions } from './versions';
import { cueDiffSummary, cueHistory, type CueHistoryEntry, type VersionMeta } from '../core/versions';

const LOOP_BEATS = [1, 2, 4, 8, 16, 32];
const ZOOM_BARS = [2, 4, 8, 16, 32];

/** The deck: waveform, pads and cues of the selected track. */
export function CueEditor({ trackId, onSelectTrack }: { trackId: string | null; onSelectTrack: (id: string) => void }) {
  const { project } = useStore();
  const track = trackId ? project.library.tracks[trackId] : undefined;
  if (!track) {
    return (
      <div className="deck-empty">
        <b>No track loaded.</b> Click a track in the library or on the timeline to load it here and set its cues.
      </div>
    );
  }
  return <TrackCueWorkspace key={track.id} track={track} onSelectTrack={onSelectTrack} />;
}

function TrackCueWorkspace({ track, onSelectTrack }: { track: Track; onSelectTrack: (id: string) => void }) {
  const { dispatch } = useStore();
  const { audio: attached, remembered, rememberedIds, loading, attach, loadRemembered, getBuffer } = useAudio();
  const folder = useMusicFolder();
  const audioInfo = attached[track.id];
  // Playable audio from this visit, or the waveform remembered from an earlier one.
  const wave = audioInfo ?? remembered[track.id];
  const [folderMiss, setFolderMiss] = useState(false);
  const deckRef = useRef<Deck | null>(null);
  const [deckReady, setDeckReady] = useState(false);
  const [activeLoopId, setActiveLoopId] = useState<string | null>(null);
  const [volume, setVolume] = useState(() => {
    try {
      const v = Number(localStorage.getItem('setcraft-volume') ?? '0.9');
      return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.9;
    } catch {
      return 0.9;
    }
  });
  const [playhead, setPlayhead] = useState(track.cues.find((c) => c.slot === 0)?.start ?? track.gridStart ?? 0);
  const [playing, setPlaying] = useState(false);
  const [snapMode, setSnapMode] = useState<SnapMode>(() => {
    try {
      const saved = localStorage.getItem('setcraft-snap');
      return saved === 'off' || saved === 'bar' ? saved : 'beat';
    } catch {
      return 'beat';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('setcraft-snap', snapMode);
    } catch {
      // private mode: not remembered
    }
  }, [snapMode]);
  const [zoomBars, setZoomBars] = useState(8);
  const [hotLoops, setHotLoops] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  /** Playing, but the browser is holding the sound back (needs a click on the page). */
  const [soundBlocked, setSoundBlocked] = useState(false);
  const meterRef = useRef<HTMLSpanElement>(null);
  // The whole deck always fits its panel: the waveform stretches first, then everything scales down.
  const fitRef = useFitZoom<HTMLDivElement>(0.45);
  useEffect(() => {
    if (!historyOpen && !autoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setHistoryOpen(false);
      setAutoOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [historyOpen, autoOpen]);
  const fileInput = useRef<HTMLInputElement>(null);

  // Show a remembered waveform straight away, then fetch the audio from the linked folder.
  useEffect(() => {
    if (audioInfo) return;
    if (rememberedIds.has(track.id) && !remembered[track.id]) void loadRemembered(track.id);
    if (folder.status !== 'ready' || loading[track.id]) return;
    let cancelled = false;
    folder
      .findFile(track.path)
      .then((file) => {
        if (cancelled) return;
        setFolderMiss(!file);
        if (file) {
          return attach(track.id, file).then((info) => {
            if (!track.duration) dispatch({ type: 'updateTrack', id: track.id, patch: { duration: info.duration } });
          });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id, track.path, folder.status, !!audioInfo, rememberedIds]);

  const duration =
    wave?.duration ?? track.duration ?? Math.max(360, ...track.cues.map((c) => (c.end ?? c.start) + 30));
  const bpm = track.bpm;
  const gridStart = track.gridStart ?? 0;
  const beat = bpm ? beatLength(bpm) : undefined;
  // Snap to the beat, the bar, or nowhere (free placement).
  const q = useCallback((s: number) => snapTime(s, snapMode, bpm, gridStart), [snapMode, bpm, gridStart]);
  // Song sections from the colour waveform (intro / breakdown / build / drop / outro).
  const sections = useMemo(
    () => (wave?.bands ? detectSections(wave.bands, wave.peaksPerSecond, wave.duration, bpm, gridStart) : []),
    [wave, bpm, gridStart],
  );

  // Dragging on the waveform snaps like the pads do (hold Shift to place freely).
  const dragSnap = snapMode !== 'off' && bpm ? q : undefined;

  const setCues = useCallback(
    (cues: Cue[]) => dispatch({ type: 'setCues', trackId: track.id, cues }),
    [dispatch, track.id],
  );
  const updateCue = (id: string, patch: Partial<Cue>) =>
    setCues(track.cues.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;

  // One deck per open track, on the shared AudioContext.
  useEffect(() => {
    const d = new Deck(audioContext(), () => {
      setPlaying(false);
      setPlayhead(d.position());
    });
    deckRef.current = d;
    return () => {
      d.dispose();
      deckRef.current = null;
    };
  }, []);

  // Load the decoded audio into the deck once the track's file is attached.
  useEffect(() => {
    setDeckReady(false);
    if (!audioInfo) return;
    let cancelled = false;
    getBuffer(track.id)
      .then((buf) => {
        const d = deckRef.current;
        if (cancelled || !buf || !d) return;
        d.load(buf);
        d.setVolume(volume);
        d.seek(playheadRef.current);
        setDeckReady(true);
      })
      .catch(() => setError('This audio could not be decoded for playback.'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioInfo, track.id]);

  useEffect(() => {
    deckRef.current?.setVolume(volume);
    try {
      localStorage.setItem('setcraft-volume', String(volume));
    } catch {
      // private mode: volume just isn't remembered
    }
  }, [volume]);

  // Follow the deck while playing. The waveforms read the deck themselves every
  // frame; the clock and the rest of the deck only need ~12 updates a second.
  // The level meter is updated directly, every frame.
  useEffect(() => {
    const meter = meterRef.current;
    if (!playing) {
      meter?.style.setProperty('--level', '0');
      return;
    }
    let raf = 0;
    let last = 0;
    let shown = 0;
    const tick = (t: number) => {
      const d = deckRef.current;
      if (d && t - last > 80) {
        last = t;
        setPlayhead(d.position());
      }
      if (d && meter) {
        // Fast attack, slow release, like a hardware meter.
        const lv = d.level();
        shown = lv > shown ? lv : shown * 0.9;
        meter.style.setProperty('--level', shown.toFixed(3));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // If the browser is holding the sound back, say so instead of playing silently.
    const check = window.setTimeout(() => setSoundBlocked(!!deckRef.current?.playing && !deckRef.current.audible), 700);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(check);
    };
  }, [playing]);
  useEffect(() => {
    const c = audioContext();
    const onState = () => c.state === 'running' && setSoundBlocked(false);
    c.addEventListener('statechange', onState);
    return () => c.removeEventListener('statechange', onState);
  }, []);

  /** Exact position right now: the live deck while playing, else the playhead. */
  const now = useCallback(() => {
    const d = deckRef.current;
    return d?.playing ? d.position() : playheadRef.current;
  }, []);
  const livePlayhead = useCallback(() => deckRef.current?.position() ?? playheadRef.current, []);

  const activeLoop = track.cues.find((c) => c.id === activeLoopId && c.kind === 'loop' && c.end !== undefined);

  const exitLoop = useCallback(() => {
    deckRef.current?.setLoop(null);
    setActiveLoopId(null);
  }, []);

  // Keep an engaged loop in step with edits (dragging, resizing, deleting).
  useEffect(() => {
    if (!activeLoopId) return;
    if (!activeLoop) exitLoop();
    else deckRef.current?.setLoop({ start: activeLoop.start, end: activeLoop.end! });
  }, [activeLoopId, activeLoop?.start, activeLoop?.end, activeLoop, exitLoop]);

  const seek = useCallback(
    (s: number) => {
      const clamped = Math.max(0, Math.min(duration, s));
      // Jumping out of an engaged loop releases it, like on a CDJ.
      if (activeLoop && (clamped < activeLoop.start || clamped >= activeLoop.end!)) exitLoop();
      setPlayhead(clamped);
      deckRef.current?.seek(clamped);
    },
    [duration, activeLoop, exitLoop],
  );

  /** Jump and start playing (when audio is loaded); no loop handling. */
  const startAt = useCallback(
    (s: number) => {
      const d = deckRef.current;
      const clamped = Math.max(0, Math.min(duration, s));
      setPlayhead(clamped);
      if (!d || !deckReady) return;
      if (d.playing) d.seek(clamped);
      else {
        d.play(clamped);
        setPlaying(true);
      }
    },
    [deckReady, duration],
  );

  const playFrom = useCallback(
    (s: number) => {
      if (activeLoop && (s < activeLoop.start || s >= activeLoop.end!)) exitLoop();
      startAt(s);
    },
    [activeLoop, exitLoop, startAt],
  );

  // Scrubbing while playing holds the audio, like a hand on the record, and
  // carries on from the new spot when you let go. (Restarting playback on every
  // mouse move is what made scrubbing stutter.)
  const hold = useRef<{ resume: boolean } | null>(null);
  const scrubStart = useCallback(() => {
    const d = deckRef.current;
    if (hold.current || !d) return;
    hold.current = { resume: d.playing };
    if (d.playing) {
      d.pause();
      setPlayhead(d.position());
    }
  }, []);
  const scrubEnd = useCallback(() => {
    const h = hold.current;
    hold.current = null;
    const d = deckRef.current;
    if (h?.resume && d && !d.playing) d.play(d.position());
  }, []);

  const togglePlay = useCallback(() => {
    const d = deckRef.current;
    if (!d || !deckReady) return;
    if (hold.current) {
      // Space while scrubbing: decide whether playback resumes on release.
      hold.current.resume = !hold.current.resume;
      setPlaying(hold.current.resume);
      return;
    }
    if (d.playing) {
      d.pause();
      setPlaying(false);
      setPlayhead(d.position());
    } else {
      d.play(playheadRef.current);
      setPlaying(true);
    }
  }, [deckReady]);

  const hotCues = useMemo(() => {
    const bySlot: (Cue | undefined)[] = Array(MAX_HOT_CUES).fill(undefined);
    for (const c of track.cues) if (c.slot !== null && c.slot < MAX_HOT_CUES) bySlot[c.slot] = c;
    return bySlot;
  }, [track.cues]);

  const firstFreeSlot = () => hotCues.findIndex((c) => !c);

  // Drag & drop between pads (and to/from memory cues).
  const [draggingCueId, setDraggingCueId] = useState<string | null>(null);
  const [padDrop, setPadDrop] = useState<number | 'memory' | null>(null);
  const startCueDrag = (e: React.DragEvent, id: string) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-setcraft-cue', id);
    setDraggingCueId(id);
  };
  const endCueDrag = () => {
    setDraggingCueId(null);
    setPadDrop(null);
  };
  const dropCueOnSlot = (slot: number | null) => {
    if (draggingCueId) {
      setCues(moveCueToSlot(track.cues, draggingCueId, slot));
      setSelectedId(draggingCueId);
    }
    endCueDrag();
  };

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
        // Loop pads engage the loop (press again to release); cue pads jump and play.
        if (existing.kind === 'loop' && existing.end !== undefined) {
          if (activeLoopId === existing.id) return exitLoop();
          deckRef.current?.setLoop(null); // release any other loop first
          startAt(existing.start);
          deckRef.current?.setLoop({ start: existing.start, end: existing.end });
          setActiveLoopId(existing.id);
          return;
        }
        playFrom(existing.start);
        return;
      }
      addCue({ kind: 'cue', slot, start: round(q(now()), 3), name: '', color: CUE_COLORS[slot] });
    },
    [hotCues, playFrom, startAt, addCue, q, playhead, activeLoopId, exitLoop],
  );

  const addLoop = (beats: number) => {
    if (!beat) return;
    const start = round(q(now()), 3);
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
    addCue({ kind: 'cue', slot: null, start: round(q(now()), 3), name: '', color: CUE_COLORS[0] });

  // Keyboard: space play, 1-8 pads, M memory cue, Q snap mode, ←/→ one beat (shift: one bar), [ ] prev/next cue.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
      // The timeline and library handle their own keys; only Space (play) reaches the deck from there.
      if ((e.target as HTMLElement).closest?.('[data-keys-own]') && e.code !== 'Space') return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (/^Digit[1-8]$/.test(e.code)) {
        pad(Number(e.code.slice(5)) - 1);
      } else if (e.key === 'm' || e.key === 'M') addMemory();
      else if (e.key === 'q' || e.key === 'Q') setSnapMode((m) => SNAP_MODES[(SNAP_MODES.indexOf(m) + 1) % SNAP_MODES.length]);
      else if (e.key === '[' || e.key === ']') {
        // Jump to the previous / next cue.
        const t = now();
        const starts = [...track.cues.map((c) => c.start)].sort((a, b) => a - b);
        const target = e.key === ']' ? starts.find((x) => x > t + 0.01) : [...starts].reverse().find((x) => x < t - 0.01);
        if (target !== undefined) seek(target);
      }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const step = (beat ?? 0.5) * (e.shiftKey ? 4 : 1) * (e.key === 'ArrowLeft' ? -1 : 1);
        seek(q(now() + step));
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
    <div className="workspace" ref={fitRef}>
      <section className="card track-head">
        <NightStepper trackId={track.id} onSelectTrack={onSelectTrack} />
        <div className="track-title">
          <h2>{track.title}</h2>
          <div className="muted">
            {track.artist}
            {track.key && (
              <b className="key-pill" style={{ background: keyColor(track.key) }}>
                {toCamelot(track.key)}
              </b>
            )}
          </div>
        </div>
        <TrackFields track={track} />
      </section>

      <section className="card deck">
        <div className="deck-bar">
          <div className="deck-left">
            <span className="clock">
              {formatTime(playhead)}
              {bpm && <span className="muted"> · bar {barBeatLabel(playhead, bpm, gridStart)}</span>}
            </span>
            {activeLoop && (
              <button className="small looping-btn" onClick={exitLoop} title="Release the loop and play on">
                ↻ {activeLoop.name || 'Loop'} · exit
              </button>
            )}
            <div className="snap-control" role="radiogroup" aria-label="Snap" title="Where cues, loops and clicks land (Q cycles; hold Shift while dragging to place freely)">
              <span className="snap-label">Snap</span>
              {SNAP_MODES.map((m) => (
                <button
                  key={m}
                  role="radio"
                  aria-checked={snapMode === m}
                  className={snapMode === m ? 'on' : ''}
                  disabled={m !== 'off' && !bpm}
                  onClick={() => setSnapMode(m)}
                >
                  {m === 'off' ? 'Free' : m === 'beat' ? 'Beat' : 'Bar'}
                </button>
              ))}
            </div>
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
          </div>

          <div className="transport">
            <button className="small" onClick={() => seek(q(now() - (beat ?? 0.5) * 4))} title="Back one bar (Shift+←)">
              −1 bar
            </button>
            <button
              className={`play-btn ${playing ? 'playing' : ''}`}
              onClick={togglePlay}
              disabled={!deckReady}
              title={playing ? 'Pause (Space)' : 'Play (Space)'}
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? (
                <svg viewBox="0 0 24 24" aria-hidden>
                  <rect x="6" y="5" width="4.2" height="14" rx="1" />
                  <rect x="13.8" y="5" width="4.2" height="14" rx="1" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d="M8.5 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.7 4.5a.8.8 0 0 0-1.2.7z" />
                </svg>
              )}
            </button>
            <button className="small" onClick={() => seek(q(now() + (beat ?? 0.5) * 4))} title="Forward one bar (Shift+→)">
              +1 bar
            </button>
          </div>

          <div className="deck-right">
          <label className="inline volume" title="Preview volume · the bar shows the level going to your speakers">
            Vol
            <span className="level-meter" ref={meterRef} aria-hidden />
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label="Volume"
            />
          </label>
          {audioInfo && !deckReady && !loading[track.id] && <span className="muted small-text">Loading audio…</span>}
          {loading[track.id] ? (
            <span className="muted">Analysing audio…</span>
          ) : (
            <button className="small" onClick={() => fileInput.current?.click()}>
              {audioInfo ? `♫ ${audioInfo.fileName}` : 'Attach audio file…'}
            </button>
          )}
          {!audioInfo && !loading[track.id] && <LinkFolderButton compact />}
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
        </div>
        {error && <div className="error-line">{error}</div>}
        {soundBlocked && (
          <div className="error-line">
            Your browser is holding the sound back.{' '}
            <button className="small primary" onClick={() => void audioContext().resume()}>
              Turn sound on
            </button>
          </div>
        )}
        {wave && !wave.bands && !loading[track.id] && (
          <div className="hint-line">
            This waveform was saved by an earlier version, in one colour. It turns into the colour waveform as soon as
            the audio loads: link your music folder (♫ in the top bar) or attach the file.
          </div>
        )}
        {!audioInfo && !loading[track.id] && remembered[track.id]?.bands && (
          <div className="hint-line info">
            Showing the remembered waveform of “{remembered[track.id].fileName}”. Attach the audio file
            {folder.status === 'ready' ? '' : ' or link your music folder'} to play it.{' '}
            {folder.status !== 'ready' && <LinkFolderButton />}
          </div>
        )}
        {!audioInfo && !loading[track.id] && !remembered[track.id] && !wave && folder.status !== 'ready' && (
          <div className="hint-line info">
            {folder.status === 'needs-permission'
              ? `Your browser needs one click to open “${folder.folderName}” again before this track can play.`
              : 'No audio for this track yet. Link the folder your music lives in, or attach the file, to see and hear it.'}{' '}
            <LinkFolderButton />
          </div>
        )}
        {!audioInfo && !loading[track.id] && folder.status === 'ready' && folderMiss && (
          <div className="hint-line">
            {track.path
              ? `Couldn't find “${track.path.split(/[\\/]/).pop()}” in ${folder.folderName}.`
              : 'This track has no file location, so it can’t be found in the linked folder.'}
          </div>
        )}
        {!bpm && (
          <div className="hint-line">
            This track has no BPM yet. Enter one above to get quantizing, bar numbers and beat-length loops.
          </div>
        )}
        <Waveform
          duration={duration}
          peaks={wave?.peaks}
          bands={wave?.bands}
          sections={sections}
          peaksPerSecond={wave?.peaksPerSecond}
          cues={track.cues}
          playhead={playhead}
          bpm={bpm}
          gridStart={gridStart}
          selectedCueId={selectedId}
          windowSeconds={beat ? zoomBars * 4 * beat : zoomBars * 2}
          fill
          onSeek={(s) => seek(q(s))}
          onScrub={seek}
          onScrubStart={scrubStart}
          onScrubEnd={scrubEnd}
          onZoom={(dir) =>
            setZoomBars((z) => ZOOM_BARS[Math.max(0, Math.min(ZOOM_BARS.length - 1, ZOOM_BARS.indexOf(z) - dir))])
          }
          livePlayhead={livePlayhead}
          playing={playing}
          onSelectCue={(id) => {
            setSelectedId(id);
          }}
          snap={dragSnap}
          onCueDrag={(id, change) => updateCue(id, change)}
        />
        <Waveform
          duration={duration}
          peaks={wave?.peaks}
          bands={wave?.bands}
          sections={sections}
          peaksPerSecond={wave?.peaksPerSecond}
          cues={track.cues}
          playhead={playhead}
          selectedCueId={selectedId}
          bpm={bpm}
          gridStart={gridStart}
          height={42}
          onSeek={(s) => seek(q(s))}
          onScrub={seek}
          onScrubStart={scrubStart}
          onScrubEnd={scrubEnd}
          livePlayhead={livePlayhead}
          playing={playing}
          snap={dragSnap}
          onCueDrag={(id, change) => updateCue(id, change)}
          onSelectCue={(id) => {
            setSelectedId(id);
            const c = track.cues.find((x) => x.id === id);
            if (c) seek(c.start);
          }}
        />
        {sections.length > 0 && (
          <div className="section-chips">
            {sections.map((sec) => (
              <button
                key={sec.start}
                className={`section-chip ${playhead >= sec.start && playhead < sec.end ? 'current' : ''}`}
                style={{ '--sec': SECTION_COLORS[sec.kind] } as React.CSSProperties}
                onClick={() => seek(q(sec.start))}
                title={`${SECTION_LABELS[sec.kind]}: ${formatTime(sec.start, false)}–${formatTime(sec.end, false)}${
                  bpm ? ` (${Math.round((sec.end - sec.start) / (beat! * 4))} bars)` : ''
                }`}
              >
                {SECTION_LABELS[sec.kind]}
                <span>{formatTime(sec.start, false)}</span>
              </button>
            ))}
            <button
              className="small auto-cue-btn"
              onClick={() => setAutoOpen(true)}
              title="Set cue points automatically from the song's sections (drop, breakdowns, build, outro…)"
            >
              ✦ Auto cues…
            </button>
          </div>
        )}
      </section>

      <div className="cue-columns">
        <section className="card">
          <div className="card-head">
            <h3>Hot cues</h3>
            <span className="muted" title="Empty pad: set a cue at the playhead. Filled pad: play from it (loop pads engage/release the loop). Keys 1–8. Drag pads to rearrange.">
              Tap to set / play · 1–8 · drag to rearrange
            </span>
          </div>
          <div className="pads">
            {hotCues.map((c, slot) => (
              <button
                key={slot}
                className={`pad ${c ? 'filled' : ''} ${c && c.id === selectedId ? 'selected' : ''} ${
                  c && c.id === activeLoopId ? 'looping' : ''
                } ${
                  padDrop === slot ? 'drop-target' : ''
                } ${c && c.id === draggingCueId ? 'drag-source' : ''}`}
                style={c ? { background: c.color, borderColor: c.color } : undefined}
                // Trigger on press, like a controller pad (no waiting for release).
                onPointerDown={(e) => {
                  if (e.button === 0) pad(slot);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') pad(slot);
                }}
                draggable={!!c}
                title={c ? 'Click to jump · drag onto another pad to move (swaps if taken) or below to make it a memory cue' : ''}
                onDragStart={(e) => c && startCueDrag(e, c.id)}
                onDragEnd={endCueDrag}
                onDragOver={(e) => {
                  if (!draggingCueId) return;
                  e.preventDefault();
                  setPadDrop(slot);
                }}
                onDragLeave={() => setPadDrop((d) => (d === slot ? null : d))}
                onDrop={(e) => {
                  e.preventDefault();
                  dropCueOnSlot(slot);
                }}
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
          {draggingCueId && track.cues.find((c) => c.id === draggingCueId)?.slot !== null && (
            <div
              className={`memory-drop ${padDrop === 'memory' ? 'over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setPadDrop('memory');
              }}
              onDragLeave={() => setPadDrop((d) => (d === 'memory' ? null : d))}
              onDrop={(e) => {
                e.preventDefault();
                dropCueOnSlot(null);
              }}
            >
              Drop here to make it a memory cue
            </div>
          )}
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
            {!selected && (
              <button className="small" onClick={() => setHistoryOpen(true)} title="Earlier versions of these cues, from your saved versions">
                History
              </button>
            )}
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
                const start = round(q(now()), 3);
                const len = selected.end !== undefined ? selected.end - selected.start : undefined;
                updateCue(selected.id, { start, end: len !== undefined ? round(start + len, 3) : undefined });
              }}
            />
          ) : sortedCues.length ? (
            <div className="cue-list-slot">
            <table className="cue-table">
              <tbody>
                {sortedCues.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    draggable
                    onDragStart={(e) => startCueDrag(e, c.id)}
                    onDragEnd={endCueDrag}
                    title="Drag onto a pad to put this cue there"
                  >
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
            </div>
          ) : (
            <p className="muted">No cues yet. Set pads, loops or memory cues on the left.</p>
          )}
        </section>
      </div>

      {autoOpen && <AutoCuePanel track={track} sections={sections} onApply={setCues} onClose={() => setAutoOpen(false)} />}
      {historyOpen &&
        // Portalled so the pop-up isn't scaled with the deck.
        createPortal(
          <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Cue history" onClick={() => setHistoryOpen(false)}>
            <div className="modal cue-history-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-body">
                <CueHistory track={track} autoLoad />
              </div>
              <footer className="modal-foot">
                <button onClick={() => setHistoryOpen(false)}>Close</button>
              </footer>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Earlier states of this track's cues from saved versions, with one-click restore. */
function CueHistory({ track, autoLoad = false }: { track: Track; autoLoad?: boolean }) {
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

/** ‹ › to step to the previous / next track in the night. */
function NightStepper({ trackId, onSelectTrack }: { trackId: string; onSelectTrack: (id: string) => void }) {
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
