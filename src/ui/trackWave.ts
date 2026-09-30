import { useEffect, useMemo } from 'react';
import { detectSections, type Section } from '../core/sections';
import type { WaveformData } from '../core/waveform';
import { useAudio } from './audio';
import { useMusicFolder } from './musicFolder';
import { useStore } from './store';

/**
 * A track's waveform and sections for display: the attached audio's, a
 * remembered one, or, failing that, analysed from the linked music folder.
 */
export function useTrackWave(trackId: string | undefined): { wave?: WaveformData; sections: Section[]; loading: boolean } {
  const { audio, remembered, rememberedIds, loading, attach, loadRemembered } = useAudio();
  const folder = useMusicFolder();
  const { project } = useStore();
  const track = trackId ? project.library.tracks[trackId] : undefined;
  const wave = trackId ? (audio[trackId] ?? remembered[trackId]) : undefined;
  const busy = !!(trackId && loading[trackId]);
  useEffect(() => {
    if (!trackId || !track || wave || busy) return;
    if (rememberedIds.has(trackId)) {
      void loadRemembered(trackId);
      return;
    }
    if (folder.status !== 'ready') return;
    let cancelled = false;
    folder
      .findFile(track.path)
      .then((f) => (!cancelled && f ? attach(trackId, f) : undefined))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, track?.path, folder.status, rememberedIds, !!wave]);
  const bpm = track?.bpm;
  const grid = track?.gridStart ?? 0;
  const sections = useMemo(
    () => (wave?.bands ? detectSections(wave.bands, wave.peaksPerSecond, wave.duration, bpm, grid) : []),
    [wave, bpm, grid],
  );
  return { wave, sections, loading: busy };
}
