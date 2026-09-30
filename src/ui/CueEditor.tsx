import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { keyColor, toCamelot } from '../core/keys';
import { nextInNight, withTimes } from '../core/setplan';
import { CUE_COLORS, MAX_HOT_CUES, SLOT_LETTERS, uid, type Cue, type Track } from '../core/model';
import { barBeatLabel, beatLength, formatTime, round, SNAP_MODES, snapTime, type SnapMode } from '../core/time';
import { audioContext, useAudio } from './audio';
import { Deck, FX_BEATS, type OutFx } from './deck';
import { moveCueToSlot } from '../core/cues';
import { useMusicFolder } from './musicFolder';
import { useFitZoom } from './fit';
import { JOG_SPEEDS, useMidi, useMidiActions } from './midi';
import { transport } from './transport';
import { useNight, useNightState } from './night';
import { NightNow, SourceSwitch } from './NightBar';
import { AutoCuePanel } from './AutoCuePanel';
import { CueHistory } from './CueHistory';
import { NightStepper, TrackFields } from './TrackFields';
import { CueForm } from './CueForm';
import { PlayerBar } from './PlayerBar';
import { PlayIcon } from './PlayIcon';
import { LinkFolderButton } from './MusicFolderControl';
import { activeSet, useStore } from './store';
import { SECTION_COLORS, Waveform } from './Waveform';
import { detectSections, SECTION_LABELS } from '../core/sections';

const LOOP_BEATS = [1, 2, 4, 8, 16, 32];
const ZOOM_BARS = [2, 4, 8, 16, 32];

/** The deck: waveform, pads and cues of the selected track. */
export function CueEditor({ trackId, onSelectTrack }: { trackId: string | null; onSelectTrack: (id: string) => void }) {
  const { project } = useStore();
  const night = useNight();
  const nightState = useNightState();
  const track = trackId ? project.library.tracks[trackId] : undefined;
  // Playing on into the next track: the next deck starts itself here once its audio is ready.
  const [autoStart, setAutoStart] = useState<{ trackId: string; at: number; play: boolean } | null>(null);
  useEffect(() => {
    if (!track) transport.publish(null);
  }, [track]);
  // With no track on the deck, Space still plays and pauses the night when the bar is on it.
  useEffect(() => {
    if (track) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.code !== 'Space' || !night.active || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      night.toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [track, night]);
  if (!track) {
    return (
      <>
        <div className="deck-empty">
          <b>No track loaded.</b> Click a track in the library or on the timeline to load it here and set its cues.
        </div>
        {createPortal(
          <div className="transport-bar empty" role="region" aria-label="Player">
            <div className="tb-left">
              <SourceSwitch />
              {nightState.active ? <NightNow /> : <span className="muted">No track loaded</span>}
            </div>
            <div className="transport">
              {nightState.active && (
                <button className="small" onClick={() => night.jumpMix(-1)} title="To just before the previous mix">
                  ◂ Mix
                </button>
              )}
              <button
                className={`play-btn ${nightState.playing ? 'playing' : ''}`}
                disabled={!nightState.active}
                onClick={() => night.toggle()}
                aria-label={nightState.playing ? 'Pause' : 'Play'}
              >
                <PlayIcon playing={nightState.playing} />
              </button>
              {nightState.active && (
                <button className="small" onClick={() => night.jumpMix(1)} title="To just before the next mix">
                  Mix ▸
                </button>
              )}
            </div>
            <div className="tb-right" />
          </div>,
          document.body,
        )}
      </>
    );
  }
  return (
    <TrackCueWorkspace
      key={track.id}
      track={track}
      onSelectTrack={onSelectTrack}
      autoStart={autoStart?.trackId === track.id ? autoStart : null}
      onAutoStarted={() => setAutoStart(null)}
      onPlayOn={(next) => {
        setAutoStart({ ...next, play: true });
        onSelectTrack(next.trackId);
      }}
    />
  );
}

function TrackCueWorkspace({
  track,
  onSelectTrack,
  autoStart,
  onAutoStarted,
  onPlayOn,
}: {
  track: Track;
  onSelectTrack: (id: string) => void;
  /** Start here as soon as the audio is ready (playing on from the previous track, or scrubbing the night). */
  autoStart: { trackId: string; at: number; play: boolean } | null;
  onAutoStarted: () => void;
  onPlayOn: (next: { trackId: string; at: number }) => void;
}) {
  const { dispatch, project } = useStore();
  const { audio: attached, remembered, rememberedIds, loading, attach, loadRemembered, getBuffer } = useAudio();
  const night = useNight();
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
  const [playhead, setPlayhead] = useState(autoStart?.at ?? track.cues.find((c) => c.slot === 0)?.start ?? track.gridStart ?? 0);
  const autoStartRef = useRef(autoStart);
  autoStartRef.current = autoStart;
  const onAutoStartedRef = useRef(onAutoStarted);
  onAutoStartedRef.current = onAutoStarted;
  const onPlayOnRef = useRef(onPlayOn);
  onPlayOnRef.current = onPlayOn;
  // "Then: next track": after an out-FX, or when a track ends, the night plays on.
  const [playOn, setPlayOn] = useState(() => {
    try {
      return localStorage.getItem('setcraft-play-on') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('setcraft-play-on', playOn ? '1' : '0');
    } catch {
      // private mode
    }
  }, [playOn]);
  const playOnRef = useRef(playOn);
  playOnRef.current = playOn;
  /** Pending switch to the next track after an out-FX. */
  const playOnTimerRef = useRef(0);
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
      // Reached the end of the track: play on through the night if asked.
      const next = nextRef.current;
      if (playOnRef.current && next && d.position() >= d.duration - 0.05) onPlayOnRef.current(next);
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
        // The previous track played on into this one: start straight away.
        const start = autoStartRef.current;
        if (start) {
          if (start.play) {
            d.play(start.at);
            setPlaying(true);
          }
          onAutoStartedRef.current();
        }
      })
      .catch(() => setError('This audio could not be decoded for playback.'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioInfo, track.id]);

  useEffect(() => {
    deckRef.current?.setVolume(volume);
    night.setVolume(volume);
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
        const pos = d.position();
        setPlayhead(pos);
        // Heading for the end with "Then: next" on: load the next track now, so it starts without a gap.
        if (playOnRef.current && pos > d.duration - 30) prewarmRef.current();
      }
      if (d) transport.publish({ trackId: track.id, pos: d.position(), playing: true });
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

  /** Scrub moves: during an out-effect they don't cut it short, they move where the track lands. */
  const scrubSeek = useCallback(
    (s: number) => {
      const d = deckRef.current;
      if (!d?.fxBusy) return seek(s);
      const clamped = Math.max(0, Math.min(duration, s));
      setPlayhead(clamped);
      d.scrubTo(clamped);
    },
    [seek, duration],
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
    // The bar is on the night: play / pause that instead.
    if (night.active) return night.toggle();
    const d = deckRef.current;
    if (!d || !deckReady) return;
    // Play / pause after an FX means "stay on this track": cancel playing on into the next one.
    window.clearTimeout(playOnTimerRef.current);
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

  // The next track in the night, and getting its audio ready before it's needed.
  const next = useMemo(() => nextInNight(activeSet(project), project.library, track.id), [project, track.id]);
  const nextRef = useRef(next);
  nextRef.current = next;

  const prewarmed = useRef<string | null>(null);
  const prewarm = useCallback(() => {
    const n = nextRef.current;
    if (!n || prewarmed.current === n.trackId) return;
    prewarmed.current = n.trackId;
    if (attached[n.trackId]) void getBuffer(n.trackId).catch(() => undefined);
    else if (folder.status === 'ready' && !loading[n.trackId]) {
      void folder
        .findFile(project.library.tracks[n.trackId]?.path)
        .then((f) => f && attach(n.trackId, f))
        .catch(() => undefined);
    }
  }, [attached, getBuffer, folder, loading, project.library.tracks, attach]);
  const prewarmRef = useRef(prewarm);
  prewarmRef.current = prewarm;
  const playOnTimer = playOnTimerRef;
  useEffect(() => () => window.clearTimeout(playOnTimerRef.current), []);

  // Out effects: hear how the track leaves. Stopped? It plays a bar from the playhead first.
  const [fxActive, setFxActive] = useState<OutFx | null>(null);
  const [fxMix, setFxMix] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem('setcraft-fx-mix') ?? '0.5');
      return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;
    } catch {
      return 0.5;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('setcraft-fx-mix', String(fxMix));
    } catch {
      // private mode
    }
  }, [fxMix]);
  const [fxBeats, setFxBeats] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem('setcraft-fx-beats'));
      return (FX_BEATS as readonly number[]).includes(v) ? v : 1;
    } catch {
      return 1;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('setcraft-fx-beats', String(fxBeats));
    } catch {
      // private mode
    }
  }, [fxBeats]);
  const fxTimer = useRef(0);
  const fireFx = useCallback(
    (kind: OutFx) => {
      window.clearTimeout(fxTimer.current);
      if (night.active) {
        // On the night, the effect plays the outgoing track out while the next one carries on.
        const flash = () => {
          if (!night.outFx(kind, fxBeats, fxMix)) return;
          setFxActive(kind);
          window.setTimeout(() => setFxActive((k) => (k === kind ? null : k)), 1800);
        };
        if (night.playing) flash();
        else {
          night.play();
          setFxActive(kind);
          fxTimer.current = window.setTimeout(flash, 2000);
        }
        return;
      }
      const d = deckRef.current;
      if (!d || !deckReady) return;
      const go = () => {
        if (!d.playing) return;
        // An out-effect plays through, not round a loop.
        if (activeLoop) exitLoop();
        const nextIn = d.outFx(kind, bpm, fxBeats, fxMix);
        const n = nextRef.current;
        // Fired mid-scrub: the track is played out, so it doesn't pick up again on release.
        if (hold.current) hold.current.resume = false;
        // While a hand is on the night or the waveform, the pointer decides where the night is.
        const scrubbing = !!hold.current;
        if (nextIn !== undefined && playOnRef.current && n && !scrubbing) {
          prewarm();
          window.clearTimeout(playOnTimer.current);
          playOnTimer.current = window.setTimeout(() => onPlayOnRef.current(n), nextIn * 1000);
        }
        setFxActive(kind);
        window.setTimeout(() => setFxActive((k) => (k === kind ? null : k)), 1800);
      };
      if (d.playing) go();
      else if (hold.current) {
        // On a scrub: straight out from the spot under the pointer, no bar of run-up.
        d.play(playheadRef.current);
        setPlaying(true);
        go();
      } else {
        d.play(playheadRef.current);
        setPlaying(true);
        setFxActive(kind);
        fxTimer.current = window.setTimeout(go, (beat ?? 0.5) * 4 * 1000);
      }
    },
    [deckReady, bpm, beat, activeLoop, exitLoop, fxBeats, fxMix, prewarm],
  );
  useEffect(() => () => window.clearTimeout(fxTimer.current), []);

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
      // The timeline and library handle their own keys; only Space (play) reaches the deck from
      // there, and the FX keys from the timeline, so they can be fired while scrubbing the night.
      const own = (e.target as HTMLElement).closest?.('[data-keys-own]');
      const fxKey = /^[erlb]$/i.test(e.key);
      if (own && e.code !== 'Space' && !(fxKey && own.classList.contains('timeline-pane'))) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (/^Digit[1-8]$/.test(e.code)) {
        pad(Number(e.code.slice(5)) - 1);
      } else if (e.key === 'm' || e.key === 'M') addMemory();
      else if (e.key === 'q' || e.key === 'Q') setSnapMode((m) => SNAP_MODES[(SNAP_MODES.indexOf(m) + 1) % SNAP_MODES.length]);
      else if (e.key === 'e' || e.key === 'E') fireFx('echo');
      else if (e.key === 'r' || e.key === 'R') fireFx('reverb');
      else if (e.key === 'l' || e.key === 'L') fireFx('loop');
      else if (e.key === 'b' || e.key === 'B') fireFx('spin');
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

  // DJ controller: the same actions as the deck's buttons and keys.
  const jog = useRef<{ pos: number; timer: number } | null>(null);
  const { jogSpeed } = useMidi();
  const jogPerTick = JOG_SPEEDS.find((s) => s.id === jogSpeed)?.perTick ?? 1 / 32;
  useMidiActions((e) => {
    if (e.action === 'volume') {
      if (e.value !== undefined) setVolume(e.value);
      return;
    }
    if (e.action === 'fxMix') {
      if (e.value !== undefined) setFxMix(e.value);
      return;
    }
    if (e.action === 'jog') {
      // Turning the jog holds the track like a hand on the record, and it plays on when you stop.
      if (!e.ticks || !deckReady) return;
      if (!jog.current) {
        scrubStart();
        jog.current = { pos: now(), timer: 0 };
      }
      const j = jog.current;
      j.pos = Math.max(0, Math.min(duration, j.pos + e.ticks * (beat ?? 0.5) * jogPerTick));
      seek(j.pos);
      window.clearTimeout(j.timer);
      j.timer = window.setTimeout(() => {
        jog.current = null;
        scrubEnd();
      }, 180);
      return;
    }
    if (!e.press) return;
    const bar = (beat ?? 0.5) * 4;
    const pads = /^pad([1-8])$/.exec(e.action);
    if (pads) return pad(Number(pads[1]) - 1);
    switch (e.action) {
      case 'play':
        return togglePlay();
      case 'barBack':
        return seek(q(now() - bar));
      case 'barFwd':
        return seek(q(now() + bar));
      case 'loop':
        return addLoop(4);
      case 'loopExit':
        return exitLoop();
      case 'memory':
        return addMemory();
      case 'fxEcho':
        return fireFx('echo');
      case 'fxReverb':
        return fireFx('reverb');
      case 'fxSpin':
        return fireFx('spin');
      case 'fxLoop':
        return fireFx('loop');
      case 'snap':
        return setSnapMode((m) => SNAP_MODES[(SNAP_MODES.indexOf(m) + 1) % SNAP_MODES.length]);
      case 'prevTrack':
      case 'nextTrack': {
        const ids = withTimes(activeSet(project), project.library)
          .entries.map((x) => x.trackId)
          .filter((id) => project.library.tracks[id]);
        const i = ids.indexOf(track.id);
        const next = e.action === 'nextTrack' ? ids[i + 1] : i > 0 ? ids[i - 1] : undefined;
        if (next && i >= 0) onSelectTrack(next);
        return;
      }
    }
  });

  // The journey-of-the-night timeline follows the deck, and can move it.
  useEffect(() => {
    if (!playing) transport.publish({ trackId: track.id, pos: playhead, playing: false });
  }, [playhead, playing, track.id]);
  // The night player taking over the speakers pauses the deck.
  useEffect(
    () =>
      transport.onClaim((owner) => {
        const d = deckRef.current;
        if (owner === 'deck' || !d) return;
        window.clearTimeout(playOnTimerRef.current);
        window.clearTimeout(fxTimer.current);
        if (hold.current) hold.current.resume = false;
        if (d.playing) {
          d.pause();
          setPlaying(false);
          setPlayhead(d.position());
        }
      }),
    [],
  );

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


          <div className="deck-right">
          {audioInfo && !deckReady && !loading[track.id] && <span className="muted small-text">Loading audio…</span>}
          {loading[track.id] ? (
            <span className="muted">Analysing audio…</span>
          ) : (
            <button className="small" onClick={() => fileInput.current?.click()}>
              {audioInfo ? `♫ ${audioInfo.fileName}` : 'Attach audio file…'}
            </button>
          )}
          {!audioInfo && !loading[track.id] && (remembered[track.id] || wave) && <LinkFolderButton compact />}
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
          onScrub={scrubSeek}
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
          onScrub={scrubSeek}
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
        <div className="deck-strip">
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
        </div>
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
          <div className="row wrap pad-actions">
            <div className="seg" role="group" aria-label="Loop at playhead">
              <span className="seg-label">Loop</span>
              {LOOP_BEATS.map((b) => (
                <button
                  key={b}
                  disabled={!beat}
                  onClick={() => addLoop(b)}
                  title={beat ? `Loop ${b} beat${b > 1 ? 's' : ''} at the playhead` : 'Needs a BPM'}
                >
                  {b}
                </button>
              ))}
            </div>
            <label className="inline toggle small-text muted" title="Put new loops on the next free pad">
              <input type="checkbox" checked={hotLoops} onChange={(e) => setHotLoops(e.target.checked)} />
              on a pad
            </label>
            <span className="grow" />
            <button className="small" onClick={addMemory} title="Memory cue at the playhead (M)">
              + Memory cue
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

      <PlayerBar
        track={track}
        playhead={playhead}
        activeLoop={activeLoop}
        onExitLoop={exitLoop}
        onBarBack={() => seek(q(now() - (beat ?? 0.5) * 4))}
        onBarForward={() => seek(q(now() + (beat ?? 0.5) * 4))}
        playing={playing}
        deckReady={deckReady}
        onTogglePlay={togglePlay}
        fxActive={fxActive}
        onFx={fireFx}
        fxBeats={fxBeats}
        onFxBeats={setFxBeats}
        fxMix={fxMix}
        onFxMix={setFxMix}
        playOn={playOn}
        onPlayOn={() => setPlayOn((v) => !v)}
        next={next ? { title: project.library.tracks[next.trackId]?.title ?? '', at: next.at } : undefined}
        volume={volume}
        onVolume={setVolume}
        meterRef={meterRef}
      />
      {autoOpen && <AutoCuePanel track={track} sections={sections} wave={wave} onApply={setCues} onClose={() => setAutoOpen(false)} />}
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
