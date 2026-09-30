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
    } catch {
      // private mode
    }
  }
  const player = shared;
  // Audio comes from a file attached this session, or else the linked music folder.
  player.setLoader((trackId) =>
    // The same decoded audio the deck uses, so a track in both is only held once.
    decodedAudio(trackId, async () => {
      const { audio: attached, folder: f, tracks } = refs.current;
      const a = attached[trackId];
      if (a) return (await fetch(a.url)).arrayBuffer();
      if (f.status === 'ready') return (await f.findFile(tracks[trackId]?.path))?.arrayBuffer();
      return undefined;
    }),
  );

  useEffect(() => {
    player.setSlots(nightSlots(buildTimeline(activeSet(project), project.library)));
  }, [player, project]);
  // A track's real length is known once its audio has been analysed (by the deck, the
  // transition view or anything else): the night is planned with it from then on.
  useEffect(() => {
    const patches: Record<string, { duration: number }> = {};
    for (const [id, a] of Object.entries(audio)) {
      const t = project.library.tracks[id];
      if (t && !t.duration && a.duration > 0) patches[id] = { duration: a.duration };
    }
    if (Object.keys(patches).length) dispatch({ type: 'updateTracks', patches });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio]);
  // Newly attached files or a linked folder: tracks that had no audio can be tried again.
  useEffect(() => player.forget(), [player, audio, folder.status]);

  return <Ctx.Provider value={player}>{children}</Ctx.Provider>;
}

export function useNight(): NightPlayer {
  const p = useContext(Ctx);
  if (!p) throw new Error('useNight outside NightProvider');
  return p;
}

/** Re-renders when the night player plays, pauses, jumps or finishes loading a track. */
export function useNightState(): { playing: boolean; active: boolean } {
  const p = useNight();
  useSyncExternalStore(
    (fn) => p.subscribe(fn),
    () => p.version,
  );
  return { playing: p.playing, active: p.active };
}
