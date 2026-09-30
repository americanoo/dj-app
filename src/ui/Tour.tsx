import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { buildTimeline } from '../core/setplan';
import type { Project } from '../core/model';
import { useAudio } from './audio';
import { makeDemoTracks } from './demo';
import { useMusicFolder } from './musicFolder';
import { useNightState } from './night';
import { activeSet, useStore } from './store';

/**
 * The first-run tutorial: a guided tour that spotlights one part of the screen
 * at a time. Most steps are hands-on: they wait for you to do the thing (add
 * tracks, press play, set a cue) and move on by themselves; Next skips ahead.
 * It opens once on a first visit and can be replayed from the ⋯ menu.
 */

const STORAGE_KEY = 'setcraft-tour';

interface TourState {
  status: 'new' | 'running' | 'done';
  step: number;
  demo?: boolean;
}

function loadState(): TourState {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (s && (s.status === 'running' || s.status === 'done')) return { status: s.status, step: s.step ?? 0, demo: s.demo };
  } catch {
    // private mode: the tour just runs from the start
  }
  return { status: 'new', step: 0 };
}

/** What the steps look at to tell whether you've done what they ask. */
interface TourCtx {
  project: Project;
  trackCount: number;
  setCount: number;
  hasBlend: boolean;
  folderReady: boolean;
  loadedTrackId: string | null;
  hotCues: number;
  deckPlaying: boolean;
  nightPlaying: boolean;
  demo: boolean;
}

interface Step {
  id: string;
  /** What to spotlight (a CSS selector); none: a card in the middle of the screen. */
  target?: string;
  title: string;
  body: ReactNode;
  /** What to do, when the step is hands-on. */
  todo?: string;
  /** Done: the tour moves on by itself. Compared with how things were when the step began. */
  done?: (now: TourCtx, start: TourCtx) => boolean;
  /** Hands-on only while this holds when the step begins; otherwise it's already done: read it and go Next. */
  needs?: (c: TourCtx) => boolean;
  /** Not on this path (e.g. importing, with the demo tracks). */
  skip?: (c: TourCtx) => boolean;
}

const STEPS: Step[] = [
  {
    id: 'import',
    target: '.topbar button.primary',
    title: 'Bring in your library',
    body: (
      <>
        Import a collection export from your DJ software: <b>rekordbox</b> XML, <b>Traktor</b> NML, <b>Serato</b> crates
        or <b>djay</b> playlists. It stays in your browser; nothing is uploaded.
      </>
    ),
    todo: 'Click Import and choose your export (or drop it anywhere on the page).',
    done: (c) => c.trackCount > 0,
    needs: (c) => c.trackCount === 0,
    skip: (c) => c.demo,
  },
  {
    id: 'folder',
    target: '.folder-btn',
    title: 'Link your music folder',
    body: (
      <>
        Point Setcraft at the folder your music lives in (subfolders too). It finds each track's audio for waveforms
        and playback. Your files stay where they are.
      </>
    ),
    todo: 'Click “Link music folder” and pick the folder. (You can do this later.)',
    done: (c) => c.folderReady,
    needs: (c) => !c.folderReady,
    skip: (c) => c.demo,
  },
  {
    id: 'library',
    target: '.library-pane',
    title: 'Your library',
    body: (
      <>
        Every track, with BPM, key (colour-coded on the Camelot wheel) and cues. Search, sort, or pick a playlist on
        the left. <b>+ Set</b> puts a track in tonight's set.
      </>
    ),
    todo: 'Click “+ Set” on two tracks, one after the other.',
    done: (c) => c.setCount >= 2,
    needs: (c) => c.setCount < 2,
  },
  {
    id: 'journey',
    target: '.timeline-host',
    title: 'The journey of the night',
    body: (
      <>
        Your set on a timeline: where each track starts and how long it plays. Drag a block to move it. When two
        overlap, both play at once: that's a <b>blend</b>. <b>▶ Play night</b> plays the whole thing.
      </>
    ),
    todo: 'Drag the second track to the left until it overlaps the end of the first.',
    done: (c) => c.hasBlend,
    needs: (c) => !c.hasBlend,
  },
  {
    id: 'transition',
    target: '.transition-pane',
    title: 'Two decks, one transition',
    body: (
      <>
        The outgoing track on the left, the incoming one on the right, and both waveforms lined up exactly as the
        night plays them. The chips tell you the blend length, the tempo and key change, and whether it lands on the
        beat. Drag the lower waveform to move where the next track comes in.
      </>
    ),
    todo: 'Press ▶ Preview to hear the transition.',
    done: (c) => c.nightPlaying,
  },
  {
    id: 'blend',
    target: '.tv-blend',
    title: 'How the two tracks meet',
    body: (
      <>
        Pick a <b>blend</b>: a bass swap (the incoming track comes in without its bass, then the basses swap), a
        crossfade, straight, or an echo out. <b>Sync</b> rides the tempos together so the beats lock. <b>⟲ Loop</b>{' '}
        repeats the transition while you try things.
      </>
    ),
  },
  {
    id: 'keyframes',
    target: '.tv-keys',
    title: 'Draw your own moves',
    body: (
      <>
        <b>✎ Keyframes</b> lets you draw the fader, EQ, filter, echo and reverb on either deck: click to add a point,
        drag it, double-click to remove. Changes play straight away.
      </>
    ),
    todo: 'Open ✎ Keyframes (or press Next).',
    done: () => !!document.querySelector('.tv-keys.on'),
  },
  {
    id: 'deck',
    target: '.deck-pane',
    title: 'The deck',
    body: (
      <>
        One track in detail: its waveform with the beat grid and song sections (intro, breakdown, drop…). Drag the
        waveform like a record to move through it; scroll to zoom with ⌘/Ctrl.
      </>
    ),
    todo: 'Click a track in the library or on the timeline to open it here.',
    done: (c) => !!c.loadedTrackId,
    needs: (c) => !c.loadedTrackId,
  },
  {
    id: 'pads',
    target: '.pads',
    title: 'Hot cues',
    body: (
      <>
        Eight pads, like on your controller. Click an empty pad to set a cue where the playhead is; click it again to
        jump there. Drag pads to rearrange them. <b>✦ Auto cues</b> fills them from the song's sections.
      </>
    ),
    todo: 'Click an empty pad to set a cue.',
    done: (c, s) => c.hotCues > s.hotCues,
  },
  {
    id: 'player',
    target: '.transport-bar',
    title: 'The player',
    body: (
      <>
        Play and pause (or <b>Space</b>), jump a bar, and <b>Deck | Night</b> to choose between the track you're editing
        and the whole night. On the right: out FX (echo, reverb, loop, backspin) and the volume.
      </>
    ),
    todo: 'Press play or pause (Space works too).',
    // Anything started or stopped during this step counts (the night may still be playing from the preview).
    done: (c, s) => c.deckPlaying !== s.deckPlaying || c.nightPlaying !== s.nightPlaying,
  },
  {
    id: 'export',
    target: '.export-btn',
    title: 'Back to your DJ software',
    body: (
      <>
        When you're ready, <b>Export</b> writes your cues, loops and grids back to rekordbox, Traktor, djay or Serato,
        and can add the night's mix points as memory cues so your plan is on the waveform when you play it for real.
      </>
    ),
  },
];

export function useTour() {
  const [state, setState] = useState<TourState>(loadState);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // private mode
    }
  }, [state]);
  return { state, setState };
}

export function Tour({
  state,
  setState,
  loadedTrackId,
}: {
  state: TourState;
  setState: (s: TourState) => void;
  loadedTrackId: string | null;
}) {
  const { project } = useStore();
  const folder = useMusicFolder();
  const nightState = useNightState();
  const demo = useDemoLoader();
  const tick = useTick(state.status === 'running');

  const ctx: TourCtx = useMemo(() => {
    const set = activeSet(project);
    const items = buildTimeline(set, project.library);
    const loaded = loadedTrackId ? project.library.tracks[loadedTrackId] : undefined;
    return {
      project,
      trackCount: Object.keys(project.library.tracks).length,
      setCount: set.entries.length,
      hasBlend: items.some((it, i) => i > 0 && it.gap < -0.5),
      folderReady: folder.status === 'ready',
      loadedTrackId,
      hotCues: loaded ? loaded.cues.filter((c) => c.slot !== null).length : 0,
      deckPlaying: !!document.querySelector('.transport-bar button.play-btn.playing') && !nightState.active,
      nightPlaying: nightState.playing,
      demo: !!state.demo,
    };
    // the DOM part (deck playing) is re-read on the poll below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, folder.status, loadedTrackId, nightState.playing, nightState.active, state.demo, tick]);

  const running = state.status === 'running';
  const step = running ? STEPS[state.step] : undefined;
  // How things were when the current step began (captured the moment the step changes).
  const startCtx = useRef<TourCtx>(ctx);
  const stepKey = running ? state.step : -1;
  const startedFor = useRef(-2);
  if (startedFor.current !== stepKey) {
    startedFor.current = stepKey;
    startCtx.current = ctx;
  }

  const finish = useCallback(() => setState({ status: 'done', step: 0, demo: state.demo }), [setState, state.demo]);
  /** On to the next step that's needed (steps already done, or not on this path, are passed over). */
  const goTo = useCallback(
    (from: number, dir: 1 | -1) => {
      let i = from;
      while (i >= 0 && i < STEPS.length && STEPS[i].skip?.(ctx)) i += dir;
      if (i >= STEPS.length) setState({ status: 'running', step: STEPS.length, demo: state.demo });
      else setState({ status: 'running', step: Math.max(0, i), demo: state.demo });
    },
    [ctx, setState, state.demo],
  );

  // Hands-on steps move on by themselves once done (after a moment, so the ✓ is seen).
  // A step whose job was already done when it began is just read (no "Try it", no moving on by itself).
  const handsOn = !!step?.done && (step.needs?.(startCtx.current) ?? true);
  const stepDone = handsOn && !!step?.done?.(ctx, startCtx.current);
  const goToRef = useRef(goTo);
  goToRef.current = goTo;
  useEffect(() => {
    if (!stepDone) return;
    const t = window.setTimeout(() => goToRef.current(stepKey + 1, 1), 700);
    return () => window.clearTimeout(t);
  }, [stepDone, stepKey]);
  // Arriving on a step that isn't needed: pass it.
  useEffect(() => {
    if (step?.skip?.(ctx)) goTo(state.step, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);

  const startDemo = async () => {
    await demo.load();
    setState({ status: 'running', step: 0, demo: true });
  };
  const demoBusy = demo.busy;

  if (state.status === 'done') return null;
  if (state.status === 'new') {
    return (
      <div className="tour-backdrop" role="dialog" aria-modal="true" aria-label="Welcome to Setcraft">
        <div className="tour-welcome">
          <span className="tour-logo" aria-hidden>
            ◐
          </span>
          <h2>Welcome to Setcraft</h2>
          <p>
            Plan the journey of your night, set cues and loops, hear exactly how each transition will sound, and send it
            all back to your DJ software. Here's a two-minute tour, hands on.
          </p>
          <div className="tour-choices">
            <button className="primary big" disabled={demoBusy} onClick={() => void startDemo()}>
              {demoBusy ? 'Making the demo tracks…' : 'Try it with demo tracks'}
            </button>
            <button className="big" disabled={demoBusy} onClick={() => setState({ status: 'running', step: 0, demo: false })}>
              Use my own music
            </button>
          </div>
          <p className="muted small-text">
            The demo tracks are made right here in your browser; you can delete them from your library any time.
          </p>
          <button className="link tour-skip" disabled={demoBusy} onClick={finish}>
            Skip the tour
          </button>
        </div>
      </div>
    );
  }

  if (!step) {
    // Past the last step: the send-off.
    return (
      <div className="tour-backdrop" role="dialog" aria-modal="true" aria-label="Tour finished">
        <div className="tour-welcome">
          <span className="tour-logo" aria-hidden>
            ✓
          </span>
          <h2>You're set</h2>
          <p>
            That's the tour. Build your night, listen to every transition, and export when it sounds right. You can
            replay this tour any time from <b>⋯ → Tutorial</b>.
          </p>
          <div className="tour-choices">
            <button className="primary big" onClick={finish}>
              Start playing
            </button>
          </div>
        </div>
      </div>
    );
  }

  const done = stepDone;
  return (
    <Coach
      key={step.id}
      target={step.target}
      index={STEPS.indexOf(step)}
      total={STEPS.length}
      title={step.title}
      body={step.body}
      todo={handsOn ? step.todo : undefined}
      done={done}
      onBack={state.step > 0 ? () => goTo(state.step - 1, -1) : undefined}
      onNext={() => goTo(state.step + 1, 1)}
      onClose={finish}
    />
  );
}

/** Re-render a few times a second while on, so steps notice things the store doesn't hold (what's playing, what's open). */
function useTick(on: boolean, ms = 400): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => setN((x) => x + 1), ms);
    return () => window.clearInterval(id);
  }, [on, ms]);
  return n;
}

/** Adds the demo tracks to the library, with their audio attached (so they play and show waveforms). */
export function useDemoLoader() {
  const { project, dispatch } = useStore();
  const { attach } = useAudio();
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const demos = await makeDemoTracks();
      for (const { track } of demos) if (!project.library.tracks[track.id]) dispatch({ type: 'addTrack', track });
      await Promise.all(demos.map(({ track, file }) => attach(track.id, file)));
    } finally {
      setBusy(false);
    }
  }, [project.library.tracks, dispatch, attach]);
  return { load, busy };
}

/** The spotlight around the target and the card that explains it. */
function Coach(p: {
  target?: string;
  index: number;
  total: number;
  title: string;
  body: ReactNode;
  todo?: string;
  done: boolean;
  onBack?: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState({ w: 340, h: 200 });

  // Follow the target as the page moves and resizes.
  useEffect(() => {
    let raf = 0;
    let last = '';
    const tick = () => {
      const el = p.target ? document.querySelector(p.target) : null;
      const r = el && (el as HTMLElement).offsetParent !== null ? el.getBoundingClientRect() : null;
      const key = r ? `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}` : '';
      if (key !== last) {
        last = key;
        setRect(r && r.width > 0 && r.height > 0 ? r : null);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [p.target]);

  useLayoutEffect(() => {
    const c = card.current;
    if (c) setCardSize({ w: c.offsetWidth, h: c.offsetHeight });
  }, [p.title, p.done]);

  // Esc ends the tour.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p]);

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const gap = 12;
  const pad = 6;
  let pos: { left: number; top: number };
  if (!rect) pos = { left: (vw - cardSize.w) / 2, top: (vh - cardSize.h) / 2 };
  else {
    const below = rect.bottom + gap + cardSize.h <= vh - 8;
    const above = rect.top - gap - cardSize.h >= 8;
    const right = rect.right + gap + cardSize.w <= vw - 8;
    const left = rect.left - gap - cardSize.w >= 8;
    const cx = Math.min(Math.max(8, rect.left + rect.width / 2 - cardSize.w / 2), vw - cardSize.w - 8);
    const cy = Math.min(Math.max(8, rect.top + rect.height / 2 - cardSize.h / 2), vh - cardSize.h - 8);
    if (below) pos = { left: cx, top: rect.bottom + gap };
    else if (above) pos = { left: cx, top: rect.top - gap - cardSize.h };
    else if (right) pos = { left: rect.right + gap, top: cy };
    else if (left) pos = { left: rect.left - gap - cardSize.w, top: cy };
    // A big panel: the card sits inside it, bottom right.
    else pos = { left: Math.min(rect.right, vw) - cardSize.w - 16, top: Math.min(rect.bottom, vh) - cardSize.h - 16 };
  }

  return (
    <>
      {rect ? (
        <div
          className="tour-spot"
          aria-hidden
          style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
        />
      ) : (
        <div className="tour-dim" aria-hidden />
      )}
      <div ref={card} className="tour-card" role="dialog" aria-label={p.title} style={{ left: pos.left, top: pos.top }}>
        <div className="tour-card-head">
          <span className="tour-count">
            {p.index + 1} / {p.total}
          </span>
          <button className="icon" onClick={p.onClose} title="End the tour (Esc)" aria-label="End the tour">
            ×
          </button>
        </div>
        <h3>{p.title}</h3>
        <p>{p.body}</p>
        {p.todo && <p className={`tour-todo ${p.done ? 'done' : ''}`}>{p.done ? '✓ Nice.' : `Try it: ${p.todo}`}</p>}
        <div className="tour-dots" aria-hidden>
          {Array.from({ length: p.total }, (_, i) => (
            <i key={i} className={i === p.index ? 'on' : i < p.index ? 'past' : ''} />
          ))}
        </div>
        <div className="tour-actions">
          {p.onBack && (
            <button className="small" onClick={p.onBack}>
              Back
            </button>
          )}
          <span className="grow" />
          <button className="small primary" onClick={p.onNext}>
            {p.index === p.total - 1 ? 'Finish' : p.todo && !p.done ? 'Skip' : 'Next'}
          </button>
        </div>
      </div>
    </>
  );
}
