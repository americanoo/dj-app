import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { buildTimeline, nightSlots } from '../core/setplan';
import { audioContext, decodedAudio, useAudio } from './audio';
import { useMusicFolder } from './musicFolder';
import { NightPlayer } from './nightPlayer';
import { activeSet, useStore } from './store';

const Ctx = createContext<NightPlayer | null>(null);
let shared: NightPlayer | null = null;

/** The night player for the whole app, fed with the active set and the audio it can find. */
export function NightProvider({ children }: { children: ReactNode }) {
  const { project, dispatch } = useStore();
  const { audio } = useAudio();
  const folder = useMusicFolder();
  const refs = useRef({ audio, folder, tracks: project.library.tracks });
  refs.current = { audio, folder, tracks: project.library.tracks };

  if (!shared) {
    shared = new NightPlayer(audioContext(), () => Promise.resolve(undefined));
    try {
      shared.setVolume(Number(localStorage.getItem('setcraft-volume') ?? '0.9'));
      shared.setKeyLock(localStorage.getItem('setcraft-keylock') !== 'off');
    } catch {
      // private mode
    }
  }
  const player = shared;
  // Tests and the console can look at the night player while developing.
  if (import.meta.env.DEV) (window as unknown as { __night?: NightPlayer }).__night = player;
  // Audio comes from a file attached this session, or else the linked music folder.
  player.setLoader((trackId) =>
    // The same decoded audio the deck uses, so a track in both is only held once.
    decodedAudio(trackId, async () => {
      const { audio: attached, folder: f, tracks } = refs.current;
      const a = attached[trackId];
      if (a) return (await fetch(a.url)).arrayBuffer();
      if (f.hasMusic) return (await f.findFile(tracks[trackId]))?.arrayBuffer();
      return undefined;
    }),
  );

  useEffect(() => {
    player.setSlots(nightSlots(buildTimeline(activeSet(project), project.library)));
  }, [player, project]);
  // A track's real length is known once its audio has been decoded (by the night, the deck,
  // the transition view or anything else): the night is planned with it from then on, rather
  // than the rounded length a collection file gave.
  const tracksRef = useRef(project.library.tracks);
  tracksRef.current = project.library.tracks;
  useEffect(() => {
    const report = (found: Record<string, number>) => {
      const durations: Record<string, number> = {};
      for (const [id, d] of Object.entries(found)) {
        const t = tracksRef.current[id];
        if (t && d > 0 && Math.abs((t.duration ?? 0) - d) > 0.02) durations[id] = d;
      }
      if (Object.keys(durations).length) dispatch({ type: 'measured', durations });
    };
    report(Object.fromEntries(Object.entries(audio).map(([id, a]) => [id, a.duration])));
    report(player.measuredDurations());
    return player.subscribe(() => report(player.measuredDurations()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio, player]);
  // Newly attached files or a linked folder: tracks that had no audio can be tried again.
  useEffect(() => player.forget(), [player, audio, folder.revision]);

  return <Ctx.Provider value={player}>{children}</Ctx.Provider>;
}

export function useNight(): NightPlayer {
  const p = useContext(Ctx);
  if (!p) throw new Error('useNight outside NightProvider');
  return p;
}

/** Re-renders when the night player plays, pauses, jumps or finishes loading a track. */
/** Key lock: on, switch it, and whether this page can do it (it needs https or this computer). */
export function useKeyLock(): { on: boolean; set: (on: boolean) => void; available: boolean } {
  const p = useNight();
  useSyncExternalStore(
    (fn) => p.subscribe(fn),
    () => p.version,
  );
  return {
    on: p.keyLock,
    available: p.keyLockAvailable,
    set: (on) => {
      p.setKeyLock(on);
      try {
        localStorage.setItem('setcraft-keylock', on ? 'on' : 'off');
      } catch {
        // private mode
      }
    },
  };
}

export function useNightState(): { playing: boolean; active: boolean } {
  const p = useNight();
  useSyncExternalStore(
    (fn) => p.subscribe(fn),
    () => p.version,
  );
  return { playing: p.playing, active: p.active };
}
