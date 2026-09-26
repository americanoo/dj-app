import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

/**
 * Audio files the DJ has attached this session. They are only used for
 * waveform display and preview playback and never leave the browser.
 */
export interface AttachedAudio {
  url: string;
  fileName: string;
  duration: number;
  /** Max-abs amplitude per bucket, 0..1. */
  peaks: Float32Array;
  peaksPerSecond: number;
}

export const PEAKS_PER_SECOND = 150;

interface AudioStore {
  audio: Record<string, AttachedAudio>;
  loading: Record<string, boolean>;
  attach: (trackId: string, file: File) => Promise<AttachedAudio>;
}

const Ctx = createContext<AudioStore | null>(null);

let sharedContext: AudioContext | null = null;

async function analyse(file: File): Promise<Omit<AttachedAudio, 'url' | 'fileName'>> {
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
  return { duration: buf.duration, peaks, peaksPerSecond: buf.sampleRate / bucket };
}

export function AudioProvider({ children }: { children: ReactNode }) {
  const [audio, setAudio] = useState<Record<string, AttachedAudio>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  const attach = useCallback(async (trackId: string, file: File) => {
    setLoading((l) => ({ ...l, [trackId]: true }));
    try {
      const info = await analyse(file);
      const entry: AttachedAudio = { ...info, url: URL.createObjectURL(file), fileName: file.name };
      setAudio((a) => {
        if (a[trackId]) URL.revokeObjectURL(a[trackId].url);
        return { ...a, [trackId]: entry };
      });
      return entry;
    } finally {
      setLoading((l) => ({ ...l, [trackId]: false }));
    }
  }, []);

  return <Ctx.Provider value={{ audio, loading, attach }}>{children}</Ctx.Provider>;
}

export function useAudio(): AudioStore {
  const s = useContext(Ctx);
  if (!s) throw new Error('useAudio outside provider');
  return s;
}

export const AUDIO_EXTENSIONS = /\.(mp3|wav|aiff?|flac|m4a|mp4|aac|ogg|opus)$/i;
