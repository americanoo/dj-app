import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Cue, SetEntry } from '../../core/model';
import { buildTimeline, itemMixIn, type TimelineItem } from '../../core/setplan';
import { newCue } from '../../core/sheet';
import { tempoMode } from '../../core/mixplan';
import { newRegion, type FxRegion, type FxTool } from '../../core/trackfx';
import { useNight, useNightState } from '../night';
import { activeSet, useStore } from '../store';
import { notify } from '../toastBus';
import {
  BackIcon,
  DiamondIcon,
  EchoIcon,
  FilterIcon,
  FlagIcon,
  KeyIcon,
  KillLowsIcon,
  LibraryIcon,
  LoopIcon,
  LoopInIcon,
  LoopOutIcon,
  MicIcon,
  MixerIcon,
  PAD_COLORS,
  PauseBig,
  PlayBig,
  PlaylistIcon,
  PlusIcon,
  RedoIcon,
  ReverbIcon,
  SettingsIcon,
  SyncIcon,
  ToolsIcon,
  UndoIcon,
} from './icons';
import { LibraryScreen } from './LibraryScreen';
import { MixerSheet } from './MixerSheet';
import { itemIndexAt, mmss, nightTimeOf, songEnd, songPos, useNightIndex, useNightTime } from './nightModel';
import { PlaylistScreen } from './PlaylistScreen';
import { SettingsScreen, type SettingsActions } from './SettingsScreen';
import type { StripMode } from './WaveStrip';
import './mobile.css';

type Screen = 'library' | 'playlist' | 'settings';
type Bar = 'nav' | 'tools' | 'cue' | 'loop';
const LOOP_SIZES = [0.5, 1, 2, 4, 8, 16];
const HOLD_MS = 420;

/**
 * Setcraft on a phone, as on the wireframes: the library ("load music"), the
 * night with its clock rulers and waveforms, and a transport row (mixer, play,
 * +). The + adds a keyframe where the night is (tap again for the end
 * keyframe); hold it to switch to hot cues or loops.
 */
export function MobileApp({
  onImport,
  onDemo,
  demoBusy,
  settings,
}: {
  onImport: () => void;
  onDemo: () => void;
  demoBusy: boolean;
  settings: SettingsActions;
}) {
  const { project, dispatch, undoLabel, redoLabel } = useStore();
  const night = useNight();
  const { playing } = useNightState();
  const set = activeSet(project);
  const items = useMemo(() => buildTimeline(set, project.library), [set, project.library]);
  const [screen, setScreen] = useState<Screen>(() => (set.entries.length ? 'playlist' : 'library'));
  const [bar, setBar] = useState<Bar>('nav');
  const [mode, setMode] = useState<StripMode>('keyframe');
  const [menuOpen, setMenuOpen] = useState(false);
  const [mixerOpen, setMixerOpen] = useState(false);
  const [region, setRegion] = useState<{ entryId: string; id: string } | null>(null);
  const [loopIn, setLoopIn] = useState<{ entryId: string; s: number } | null>(null);
  const [loopSize, setLoopSize] = useState<number | null>(null);
  const [loopCue, setLoopCue] = useState<{ trackId: string; id: string } | null>(null);

  // The demo: its tracks go straight into the night.
  const demoAsked = useRef(false);
  const trackIds = Object.keys(project.library.tracks);
  useEffect(() => {
    if (!demoAsked.current || demoBusy || !trackIds.length) return;
    demoAsked.current = false;
    if (!set.entries.length) dispatch({ type: 'addEntries', trackIds, blend: true });
    setScreen('playlist');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoBusy, trackIds.length]);

  // Looping is only previewed while the loop bar is up.
  useEffect(() => {
    if (bar !== 'loop') night.setLoop(null);
  }, [bar, night]);

  /** The track where the night is, and the spot in it. */
  const here = (): { it: TimelineItem; s: number; t: number } | null => {
    const t = night.position();
    const i = itemIndexAt(items, t);
    const it = items[i];
    if (!it?.track) {
      notify(items.length ? 'That track is missing from your library.' : 'Add tracks to the night first.', 'error');
      return null;
    }
    return { it, s: songPos(it, t), t };
  };
  const updateEntry = (id: string, patch: Partial<SetEntry>) => dispatch({ type: 'updateEntry', id, patch });
  const setCues = (trackId: string, cues: Cue[]) => dispatch({ type: 'setCues', trackId, cues });

  // The keyframe being edited, if it still exists.
  const regionEntry = region ? items.find((x) => x.entry.id === region.entryId) : undefined;
  const activeRegion = regionEntry?.entry.fx?.find((r) => r.id === region?.id);
  const writeRegion = (it: TimelineItem, r: FxRegion) =>
    updateEntry(it.entry.id, { fx: [...(it.entry.fx ?? []).filter((x) => x.id !== r.id), r].sort((a, b) => a.from - b.from) });

  const keyframe = () => {
    const h = here();
    if (!h) return;
    const { it, s } = h;
    const open = activeRegion && regionEntry?.entry.id === it.entry.id && activeRegion.to === undefined ? activeRegion : undefined;
    if (open) {
      if (Math.abs(s - open.from) < 0.25) return notify('Move on a little first: the end keyframe comes after the start.', 'error');
      const r = s > open.from ? { ...open, to: s } : { ...open, from: s, to: open.from };
      writeRegion(it, r);
      notify(`End keyframe at ${mmss(s)}${r.tools.length ? '' : ': pick its effects below'}.`);
    } else {
      const r = newRegion(s);
      writeRegion(it, r);
      setRegion({ entryId: it.entry.id, id: r.id });
      notify(`Start keyframe at ${mmss(s)}. Pick its effects, then + again for the end.`);
    }
    setBar('tools');
  };

  const toggleTool = (tool: FxTool | 'stems') => {
    let it = regionEntry;
    let r = activeRegion;
    if (!it || !r) {
      const h = here();
      if (!h) return;
      it = h.it;
      r = newRegion(h.s);
      setRegion({ entryId: it.entry.id, id: r.id });
    }
    let tools = r.tools;
    if (tool === 'stems') {
      // Off → acapella → instrumental → off.
      tools = tools.includes('acapella')
        ? [...tools.filter((x) => x !== 'acapella'), 'instrumental']
        : tools.includes('instrumental')
          ? tools.filter((x) => x !== 'instrumental')
          : [...tools, 'acapella'];
    } else tools = tools.includes(tool) ? tools.filter((x) => x !== tool) : [...tools, tool];
    writeRegion(it, { ...r, tools });
  };

  const hotCue = () => {
    const h = here();
    if (!h) return;
    const { it, s } = h;
    const cue = newCue(it.track!.cues, 'cue', s);
    if (cue.slot === null) return notify('All 8 hot cues are set on this track. Hold a pad to clear one.', 'error');
    setCues(it.track!.id, [...it.track!.cues, cue]);
    notify(`Hot cue ${cue.slot + 1} at ${mmss(s)}.`);
  };

  const previewLoop = (it: TimelineItem, a: number, b: number) => {
    night.setLoop({ from: nightTimeOf(it, a), to: nightTimeOf(it, b) });
    if (!night.playing) night.play(nightTimeOf(it, a));
  };
  const makeLoop = (it: TimelineItem, a: number, b: number) => {
    const t = it.track!;
    // Resizing the loop just made replaces it rather than piling up loops.
    const prev = loopCue?.trackId === t.id ? t.cues.find((c) => c.id === loopCue.id) : undefined;
    const cue: Cue = prev ? { ...prev, start: a, end: b, edited: true } : { ...newCue(t.cues, 'loop', a, t.bpm), end: b };
    setCues(t.id, prev ? t.cues.map((c) => (c.id === prev.id ? cue : c)) : [...t.cues, cue]);
    setLoopCue({ trackId: t.id, id: cue.id });
    setLoopIn(null);
    previewLoop(it, a, b);
    if (!prev) {
      notify(`Loop ${mmss(a)}–${mmss(b)} saved.`, 'info', {
        label: 'End on it',
        run: () => updateEntry(it.entry.id, { endLoop: { cueId: cue.id, times: 4 } }),
      });
    }
  };
  const loopInAt = () => {
    const h = here();
    if (!h) return;
    setLoopIn({ entryId: h.it.entry.id, s: h.s });
    setLoopCue(null);
    setLoopSize(null);
    notify(`Loop in at ${mmss(h.s)}: now + (or loop out) where it ends.`);
  };
  const loopOutAt = () => {
    const h = here();
    if (!h) return;
    if (!loopIn || loopIn.entryId !== h.it.entry.id) return loopInAt();
    if (h.s <= loopIn.s + 0.1) return notify('The loop out comes after the loop in.', 'error');
    makeLoop(h.it, loopIn.s, h.s);
  };
  const loopBars = (bars: number) => {
    const h = here();
    if (!h) return;
    const t = h.it.track!;
    const beat = 60 / (t.bpm || 120);
    const from = loopIn?.entryId === h.it.entry.id ? loopIn.s : (loopCue?.trackId === t.id ? t.cues.find((c) => c.id === loopCue.id)?.start : undefined) ?? snapBeat(h.s, beat, t.gridStart ?? 0);
    setLoopSize(bars);
    makeLoop(h.it, from, from + bars * 4 * beat);
  };

  const plus = () => {
    if (mode === 'cue') return hotCue();
    if (mode === 'loop') return loopIn ? loopOutAt() : loopInAt();
    return keyframe();
  };
  const choose = (m: StripMode) => {
    setMenuOpen(false);
    setMode(m);
    setBar(m === 'keyframe' ? 'tools' : m);
  };
  const back = () => {
    setBar('nav');
    setMode('keyframe');
    setLoopIn(null);
  };

  // Tap +, or hold it for the menu.
  const hold = useRef<{ timer: number; held: boolean } | null>(null);
  const plusDown = () => {
    const h = { timer: 0, held: false };
    h.timer = window.setTimeout(() => {
      h.held = true;
      setMenuOpen(true);
    }, HOLD_MS);
    hold.current = h;
  };
  const plusUp = () => {
    const h = hold.current;
    hold.current = null;
    if (!h) return;
    window.clearTimeout(h.timer);
    if (!h.held) plus();
  };

  const focusIdx = useNightIndex(items);
  const focus = items[focusIdx];
  const nextPad = (() => {
    const t = focus?.track;
    const used = new Set(t?.cues.map((c) => c.slot));
    return ([0, 1, 2, 3, 4, 5, 6, 7].find((s) => !used.has(s)) ?? 0) + 1;
  })();
  const plusLabel =
    mode === 'cue' ? `set hot cue ${nextPad}` : mode === 'loop' ? (loopIn ? 'loop out' : 'loop in') : activeRegion && activeRegion.to === undefined ? 'add end keyframe' : 'add keyframe';

  const header = (title: string, extra?: ReactNode) => (
    <header className="m-head">
      <h1>{title}</h1>
      {extra}
      <span className="grow" />
      <button className="m-icon" aria-label="Undo" title={undoLabel ? `Undo ${undoLabel}` : 'Nothing to undo'} disabled={!undoLabel} onClick={() => dispatch({ type: 'undo' })}>
        <UndoIcon />
      </button>
      <button className="m-icon" aria-label="Redo" title={redoLabel ? `Redo ${redoLabel}` : 'Nothing to redo'} disabled={!redoLabel} onClick={() => dispatch({ type: 'redo' })}>
        <RedoIcon />
      </button>
    </header>
  );

  const tempoOn = focus ? tempoMode(focus.entry) !== 'free' : false;
  const toolOn = (t: FxTool) => !!activeRegion?.tools.includes(t);

  return (
    <div className={`m-app bar-${bar}`}>
      {screen === 'library' && <LibraryScreen
          header={header('LOAD MUSIC')}
          onImport={onImport}
          onDemo={() => {
            demoAsked.current = true;
            onDemo();
          }}
          demoBusy={demoBusy}
        />}
      {screen === 'playlist' && (
        <PlaylistScreen
          items={items}
          header={header(
            set.name.toUpperCase(),
            <label className="m-start" title="when the night starts: the rulers show real times">
              <span>start</span>
              <input
                type="time"
                aria-label="start time"
                value={set.startClock ?? ''}
                onChange={(e) => dispatch({ type: 'updateSet', patch: { startClock: e.target.value || undefined } })}
              />
            </label>,
          )}
          mode={mode}
          activeRegionId={activeRegion?.id}
          loopIn={loopIn ?? undefined}
          onAddTracks={() => setScreen('library')}
          footer={null}
        />
      )}
      {screen === 'settings' && <SettingsScreen header={header('SETTINGS')} actions={settings} />}

      {screen === 'playlist' && items.length > 0 && (
        <div className="m-transport">
          {focus && <NowLine it={focus} />}
          <div className="m-transport-row">
            <button className={`m-ctl${mixerOpen ? ' on' : ''}`} aria-label="mixer" title="mixer: vocals and instrumental levels" onClick={() => setMixerOpen((o) => !o)}>
              <MixerIcon />
            </button>
            <div className="m-play-ring">
              <button className="m-play" aria-label={playing ? 'pause' : 'play'} onClick={() => night.toggle()}>
                {playing ? <PauseBig /> : <PlayBig />}
              </button>
            </div>
            <div className="m-plus-wrap">
              <button
                className={`m-ctl m-plus mode-${mode}${menuOpen ? ' held' : ''}${mode === 'keyframe' && activeRegion?.to === undefined && activeRegion ? ' open' : ''}`}
                aria-label={plusLabel}
                title={`${plusLabel} (hold to choose a function)`}
                onPointerDown={plusDown}
                onPointerUp={plusUp}
                onPointerLeave={() => hold.current && !hold.current.held && (window.clearTimeout(hold.current.timer), (hold.current = null))}
                onContextMenu={(e) => e.preventDefault()}
              >
                {mode === 'cue' ? <FlagIcon /> : mode === 'loop' ? <LoopIcon /> : <PlusIcon />}
              </button>
              <span className="m-plus-cap">{mode === 'cue' ? `cue ${nextPad}` : mode === 'loop' ? (loopIn ? 'out' : 'in') : activeRegion?.to === undefined && activeRegion ? 'end' : 'key'}</span>
            </div>
          </div>
          {menuOpen && (
            <>
              <div className="m-scrim" onClick={() => setMenuOpen(false)} />
              <div className="m-popover m-plus-menu" role="listbox" aria-label="hold plus to choose a function">
                <button role="option" aria-selected={mode === 'keyframe'} className={mode === 'keyframe' ? 'on' : ''} onClick={() => choose('keyframe')}>
                  <span className="ic red">
                    <DiamondIcon />
                  </span>
                  create keyframe
                </button>
                <button role="option" aria-selected={mode === 'cue'} className={mode === 'cue' ? 'on' : ''} onClick={() => choose('cue')}>
                  <span className="ic purple">
                    <FlagIcon />
                  </span>
                  set hot cue {nextPad}
                </button>
                <button role="option" aria-selected={mode === 'loop'} className={mode === 'loop' ? 'on' : ''} onClick={() => choose('loop')}>
                  <span className="ic blue">
                    <LoopIcon />
                  </span>
                  loop in / out
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {mixerOpen && screen === 'playlist' && focus && <MixerSheet it={focus} onClose={() => setMixerOpen(false)} />}

      <div className="m-bar-wrap">
        {bar === 'nav' || screen !== 'playlist' ? (
          <nav className="m-bar" aria-label="main">
            <NavBtn label="library" on={screen === 'library'} onClick={() => setScreen('library')}>
              <LibraryIcon />
            </NavBtn>
            <NavBtn label="playlist" on={screen === 'playlist'} onClick={() => setScreen('playlist')}>
              <PlaylistIcon />
            </NavBtn>
            <NavBtn
              label="tools"
              on={false}
              onClick={() => {
                setScreen('playlist');
                setMode('keyframe');
                setBar('tools');
              }}
            >
              <ToolsIcon />
            </NavBtn>
            <NavBtn label="settings" on={screen === 'settings'} onClick={() => setScreen('settings')}>
              <SettingsIcon />
            </NavBtn>
          </nav>
        ) : bar === 'tools' ? (
          <nav className="m-bar" aria-label="keyframe effects">
            <BackBtn onClick={back} />
            <ToolBtn label="echo out" on={toolOn('echo')} onClick={() => toggleTool('echo')}>
              <EchoIcon />
            </ToolBtn>
            <ToolBtn label="reverb out" on={toolOn('reverb')} onClick={() => toggleTool('reverb')}>
              <ReverbIcon />
            </ToolBtn>
            <ToolBtn label="filter" on={toolOn('filter')} onClick={() => toggleTool('filter')}>
              <FilterIcon />
            </ToolBtn>
            <ToolBtn label="kill lows" on={toolOn('killLows')} onClick={() => toggleTool('killLows')}>
              <KillLowsIcon />
            </ToolBtn>
            <ToolBtn
              label={`acapella / instrumental mode${toolOn('acapella') ? ': acapella' : toolOn('instrumental') ? ': instrumental' : ''}`}
              on={toolOn('acapella') || toolOn('instrumental')}
              tag={toolOn('acapella') ? 'vox' : toolOn('instrumental') ? 'inst' : undefined}
              onClick={() => toggleTool('stems')}
            >
              <MicIcon />
            </ToolBtn>
            <ToolBtn
              label="match key"
              on={!!focus?.entry.matchKey}
              onClick={() => focus && updateEntry(focus.entry.id, { matchKey: !focus.entry.matchKey })}
            >
              <KeyIcon />
            </ToolBtn>
            <ToolBtn
              label="sync"
              on={tempoOn}
              onClick={() => focus && updateEntry(focus.entry.id, { tempo: tempoOn ? 'free' : 'ride', sync: undefined })}
            >
              <SyncIcon />
            </ToolBtn>
          </nav>
        ) : bar === 'cue' ? (
          <CuePads it={focus} onBack={back} />
        ) : (
          <nav className="m-bar" aria-label="loop length">
            <BackBtn onClick={back} />
            <button className="m-bar-btn" aria-label="loop in" title="loop in" onClick={loopInAt}>
              <span className="ic purple">
                <LoopInIcon />
              </span>
            </button>
            <button className="m-bar-btn" aria-label="loop out" title="loop out" onClick={loopOutAt}>
              <span className="ic pink">
                <LoopOutIcon />
              </span>
            </button>
            {LOOP_SIZES.map((b) => (
              <button key={b} className={`m-bar-btn m-size${loopSize === b ? ' on' : ''}`} aria-label={`loop ${b === 0.5 ? '1/2' : b} bars`} aria-pressed={loopSize === b} onClick={() => loopBars(b)}>
                <span className="n">{b === 0.5 ? '1/2' : b}</span>
                <span className="u">bars</span>
              </button>
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}

/** The track playing now and how far into it the night is. */
function NowLine({ it }: { it: TimelineItem }) {
  const t = useNightTime();
  return (
    <div className="m-now">
      <b>{it.track?.title ?? 'Missing track'}</b> · {mmss(Math.max(0, Math.min(it.playFor, t - it.startsAt)))} / {mmss(it.playFor)}
    </div>
  );
}

function snapBeat(s: number, beat: number, grid: number): number {
  return Math.max(0, grid + Math.round((s - grid) / beat) * beat);
}

function NavBtn({ label, on, onClick, children }: { label: string; on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className={`m-bar-btn${on ? ' on' : ''}`} aria-label={label} title={label} aria-current={on ? 'page' : undefined} onClick={onClick}>
      {children}
    </button>
  );
}

function ToolBtn({ label, on, onClick, children, tag }: { label: string; on: boolean; onClick: () => void; children: ReactNode; tag?: string }) {
  return (
    <button className={`m-bar-btn m-tool${on ? ' on' : ''}`} aria-label={label} title={label} aria-pressed={on} onClick={onClick}>
      {children}
      {tag && <span className="m-tool-tag">{tag}</span>}
    </button>
  );
}

function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button className="m-bar-btn m-back" aria-label="back to the main menu" title="back" onClick={onClick}>
      <BackIcon />
    </button>
  );
}

/** Hot cue mode's bar: the 8 pads of the track playing now. Tap to jump there; hold to clear. */
function CuePads({ it, onBack }: { it: TimelineItem | undefined; onBack: () => void }) {
  const night = useNight();
  const { dispatch } = useStore();
  const cues = it?.track?.cues ?? [];
  const timer = useRef(0);
  const held = useRef(false);
  return (
    <nav className="m-bar" aria-label="hot cues">
      <BackBtn onClick={onBack} />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((slot) => {
        const c = cues.find((x) => x.slot === slot);
        return (
          <button
            key={slot}
            className={`m-bar-btn m-pad${c ? '' : ' empty'}`}
            aria-label={c ? `hot cue ${slot + 1} at ${mmss(c.start).replace(/^0/, '')}` : `hot cue ${slot + 1} (empty)`}
            onPointerDown={() => {
              held.current = false;
              if (!c || !it?.track) return;
              timer.current = window.setTimeout(() => {
                held.current = true;
                dispatch({ type: 'setCues', trackId: it.track!.id, cues: cues.filter((x) => x.id !== c.id) });
                notify(`Hot cue ${slot + 1} cleared.`, 'info', { label: 'Undo', run: () => dispatch({ type: 'undo' }) });
              }, 600);
            }}
            onPointerUp={() => window.clearTimeout(timer.current)}
            onPointerLeave={() => window.clearTimeout(timer.current)}
            onContextMenu={(e) => e.preventDefault()}
            onClick={() => {
              if (held.current || !c || !it) return;
              const mixIn = itemMixIn(it);
              if (c.start < mixIn || c.start > songEnd(it)) notify(`Hot cue ${slot + 1} is outside the part of the track that plays tonight.`, 'error');
              else night.seek(nightTimeOf(it, c.start));
            }}
          >
            <span className="n" style={{ color: c ? PAD_COLORS[slot] : undefined }}>
              {slot + 1}
            </span>
            <span className="u">{c ? mmss(c.start).replace(/^0/, '') : '–'}</span>
          </button>
        );
      })}
    </nav>
  );
}
