import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { del, delMany, get, keys, set as idbSet } from 'idb-keyval';
import { decodeWaveform, encodeWaveform, type StoredWaveform, type WaveformData } from '../core/waveform';

/**
 * Audio files the DJ has attached this session. They are only used for
 * waveform display and preview playback and never leave the browser. Each
 * waveform's shape (not the audio) is remembered in IndexedDB, so it can be
 * shown on later visits before the file is attached again.
 */
export interface AttachedAudio extends WaveformData {
  url: string;
}

export const PEAKS_PER_SECOND = 150;

const WAVEFORM_PREFIX = 'setcraft-waveform-v1:';
const waveformKey = (trackId: string) => WAVEFORM_PREFIX + trackId;

interface AudioStore {
  /** Attached this session: waveform plus playable audio. */
  audio: Record<string, AttachedAudio>;
  /** Remembered from an earlier session: waveform only. */
  remembered: Record<string, WaveformData>;
  /** Tracks that have a remembered waveform (loaded or not). */
  rememberedIds: ReadonlySet<string>;
  loading: Record<string, boolean>;
  attach: (trackId: string, file: File) => Promise<AttachedAudio>;
  /** Load a remembered waveform into `remembered`, if there is one. */
  loadRemembered: (trackId: string) => Promise<void>;
  forget: (trackId: string) => void;
  forgetAll: () => void;
}

const Ctx = createContext<AudioStore | null>(null);

let sharedContext: AudioContext | null = null;

async function analyse(file: File): Promise<WaveformData> {
  sharedContext ??= new AudioContext();
  const buf = await sharedContext.decodeAudioData(await file.arrayBuffer());
  const bucket = Math.max(1, Math.floor(buf.sampleRate / PEAKS_PER_SECOND));
  const n = Math.ceil(buf.length / bucket);
  const peaks = new Float32Array(n);
  const channels = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  for (let b = 0; b < n; b++) {
    let max = 0;
    const end = Math.min(buf.length, (b + 1) * bucket);
    for (const ch of channels) {
      for (let i = b * bucket; i < end; i += 4) {
        const v = Math.abs(ch[i]);
        if (v > max) max = v;
      }
    }
    peaks[b] = max;
  }
  return { duration: buf.duration, peaks, peaksPerSecond: buf.sampleRate / bucket, fileName: file.name };
}

export function AudioProvider({ children }: { children: ReactNode }) {
  const [audio, setAudio] = useState<Record<string, AttachedAudio>>({});
  const [remembered, setRemembered] = useState<Record<string, WaveformData>>({});
  const [rememberedIds, setRememberedIds] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  // Only the keys are read up front; waveforms load when a track is opened.
  useEffect(() => {
    keys()
      .then((all) => {
        const ids = all
          .filter((k): k is string => typeof k === 'string' && k.startsWith(WAVEFORM_PREFIX))
          .map((k) => k.slice(WAVEFORM_PREFIX.length));
        setRememberedIds(new Set(ids));
      })
      .catch(() => undefined);
  }, []);

  const attach = useCallback(async (trackId: string, file: File) => {
    setLoading((l) => ({ ...l, [trackId]: true }));
    try {
      const info = await analyse(file);
      const entry: AttachedAudio = { ...info, url: URL.createObjectURL(file) };
      setAudio((a) => {
        if (a[trackId]) URL.revokeObjectURL(a[trackId].url);
        return { ...a, [trackId]: entry };
      });
      idbSet(waveformKey(trackId), encodeWaveform(info))
        .then(() => setRememberedIds((s) => new Set(s).add(trackId)))
        .catch(() => undefined); // storage full or unavailable: still works this session
      return entry;
    } finally {
      setLoading((l) => ({ ...l, [trackId]: false }));
    }
  }, []);

  const loadRemembered = useCallback(async (trackId: string) => {
    const w = decodeWaveform(await get<StoredWaveform>(waveformKey(trackId)).catch(() => undefined));
    if (w) setRemembered((r) => ({ ...r, [trackId]: w }));
  }, []);

  const forget = useCallback((trackId: string) => {
    del(waveformKey(trackId)).catch(() => undefined);
    setRemembered(({ [trackId]: _, ...rest }) => rest);
    setRememberedIds((s) => {
      const n = new Set(s);
      n.delete(trackId);
      return n;
    });
  }, []);

  const forgetAll = useCallback(() => {
    keys()
      .then((all) => delMany(all.filter((k) => typeof k === 'string' && k.startsWith(WAVEFORM_PREFIX))))
      .catch(() => undefined);
    setRemembered({});
    setRememberedIds(new Set());
  }, []);

  return (
    <Ctx.Provider value={{ audio, remembered, rememberedIds, loading, attach, loadRemembered, forget, forgetAll }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAudio(): AudioStore {
  const s = useContext(Ctx);
  if (!s) throw new Error('useAudio outside provider');
  return s;
}

export const AUDIO_EXTENSIONS = /\.(mp3|wav|aiff?|flac|m4a|mp4|aac|ogg|opus)$/i;
