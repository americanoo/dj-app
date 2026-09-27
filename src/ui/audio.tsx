import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { del, delMany, get, keys, set as idbSet } from 'idb-keyval';
import { analyseBands, type BandPeaks } from '../core/analysis';
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

// Colour (three-band) waveforms. Single-colour ones saved by earlier versions
// stay under the old prefix until the track is analysed again.
const WAVEFORM_PREFIX = 'setcraft-waveform-v2:';
const LEGACY_PREFIX = 'setcraft-waveform-v1:';
const waveformKey = (trackId: string) => WAVEFORM_PREFIX + trackId;
const legacyKey = (trackId: string) => LEGACY_PREFIX + trackId;
const isWaveformKey = (k: IDBValidKey): k is string =>
  typeof k === 'string' && (k.startsWith(WAVEFORM_PREFIX) || k.startsWith(LEGACY_PREFIX));

interface AudioStore {
  /** Attached this session: waveform plus playable audio. */
  audio: Record<string, AttachedAudio>;
  /** Remembered from an earlier session: waveform only. */
  remembered: Record<string, WaveformData>;
  /** Tracks that have a remembered waveform (loaded or not). */
  rememberedIds: ReadonlySet<string>;
  /** Of those, the single-colour ones from an earlier version, worth analysing again. */
  outdatedIds: ReadonlySet<string>;
  loading: Record<string, boolean>;
  attach: (trackId: string, file: File) => Promise<AttachedAudio>;
  /** Load a remembered waveform into `remembered`, if there is one. */
  loadRemembered: (trackId: string) => Promise<void>;
  forget: (trackId: string) => void;
  forgetAll: () => void;
  /** Decoded audio for playback (decodes again if another track was decoded since). */
  getBuffer: (trackId: string) => Promise<AudioBuffer | undefined>;
}

const Ctx = createContext<AudioStore | null>(null);

let sharedContext: AudioContext | null = null;

/** One AudioContext for decoding and playback, so decoded audio plays without resampling. */
export function audioContext(): AudioContext {
  sharedContext ??= new AudioContext({ latencyHint: 'interactive' });
  return sharedContext;
}

let worker: Worker | null | undefined;
let nextJob = 0;
const jobs = new Map<number, (r: BandPeaks) => void>();

function analysisWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./analysisWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; result: BandPeaks }>) => {
      jobs.get(e.data.id)?.(e.data.result);
      jobs.delete(e.data.id);
    };
  } catch {
    worker = null;
  }
  return worker;
}

/** Three-band analysis, in a worker when available (the main thread otherwise). */
function runAnalysis(buf: AudioBuffer): Promise<BandPeaks> {
  const w = analysisWorker();
  if (!w) {
    const channels = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
    return Promise.resolve(analyseBands(channels, buf.sampleRate, PEAKS_PER_SECOND));
  }
  // Copies, so the AudioBuffer stays playable after the data is transferred.
  const channels = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i).slice());
  const id = nextJob++;
  return new Promise((resolve) => {
    jobs.set(id, resolve);
    w.postMessage(
      { id, channels, sampleRate: buf.sampleRate, peaksPerSecond: PEAKS_PER_SECOND },
      channels.map((c) => c.buffer),
    );
  });
}

/**
 * Most recently decoded track. Decoded audio is large (about 130 MB for six
 * minutes of stereo), so only one is kept, for the deck.
 */
let decoded: { trackId: string; buffer: AudioBuffer } | null = null;

async function analyse(trackId: string, file: File): Promise<WaveformData> {
  const buf = await audioContext().decodeAudioData(await file.arrayBuffer());
  decoded = { trackId, buffer: buf };
  const r = await runAnalysis(buf);
  return {
    duration: buf.duration,
    peaks: r.peaks,
    bands: { low: r.low, mid: r.mid, high: r.high },
    peaksPerSecond: r.peaksPerSecond,
    fileName: file.name,
  };
}

export function AudioProvider({ children }: { children: ReactNode }) {
  const [audio, setAudio] = useState<Record<string, AttachedAudio>>({});
  const [remembered, setRemembered] = useState<Record<string, WaveformData>>({});
  const [rememberedIds, setRememberedIds] = useState<ReadonlySet<string>>(new Set());
  const [outdatedIds, setOutdatedIds] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  // Only the keys are read up front; waveforms load when a track is opened.
  useEffect(() => {
    keys()
      .then((all) => {
        const strings = all.filter((k): k is string => typeof k === 'string');
        const colour = new Set(strings.filter((k) => k.startsWith(WAVEFORM_PREFIX)).map((k) => k.slice(WAVEFORM_PREFIX.length)));
        const legacy = strings
          .filter((k) => k.startsWith(LEGACY_PREFIX))
          .map((k) => k.slice(LEGACY_PREFIX.length))
          .filter((id) => !colour.has(id));
        setRememberedIds(new Set([...colour, ...legacy]));
        setOutdatedIds(new Set(legacy));
      })
      .catch(() => undefined);
  }, []);

  const attach = useCallback(async (trackId: string, file: File) => {
    setLoading((l) => ({ ...l, [trackId]: true }));
    try {
      const info = await analyse(trackId, file);
      const entry: AttachedAudio = { ...info, url: URL.createObjectURL(file) };
      setAudio((a) => {
        if (a[trackId]) URL.revokeObjectURL(a[trackId].url);
        return { ...a, [trackId]: entry };
      });
      setRemembered(({ [trackId]: _, ...rest }) => rest); // the fresh analysis replaces any old one
      idbSet(waveformKey(trackId), encodeWaveform(info))
        .then(() => {
          del(legacyKey(trackId)).catch(() => undefined);
          setRememberedIds((s) => new Set(s).add(trackId));
          setOutdatedIds((s) => {
            const n = new Set(s);
            n.delete(trackId);
            return n;
          });
        })
        .catch(() => undefined); // storage full or unavailable: still works this session
      return entry;
    } finally {
      setLoading((l) => ({ ...l, [trackId]: false }));
    }
  }, []);

  const loadRemembered = useCallback(async (trackId: string) => {
    const stored =
      (await get<StoredWaveform>(waveformKey(trackId)).catch(() => undefined)) ??
      (await get<StoredWaveform>(legacyKey(trackId)).catch(() => undefined));
    const w = decodeWaveform(stored);
    if (w) setRemembered((r) => ({ ...r, [trackId]: w }));
  }, []);

  const forget = useCallback((trackId: string) => {
    del(waveformKey(trackId)).catch(() => undefined);
    del(legacyKey(trackId)).catch(() => undefined);
    setRemembered(({ [trackId]: _, ...rest }) => rest);
    setOutdatedIds((s) => {
      const n = new Set(s);
      n.delete(trackId);
      return n;
    });
    setRememberedIds((s) => {
      const n = new Set(s);
      n.delete(trackId);
      return n;
    });
  }, []);

  const forgetAll = useCallback(() => {
    keys()
      .then((all) => delMany(all.filter(isWaveformKey)))
      .catch(() => undefined);
    setRemembered({});
    setRememberedIds(new Set());
    setOutdatedIds(new Set());
  }, []);

  const getBuffer = useCallback(
    async (trackId: string) => {
      if (decoded?.trackId === trackId) return decoded.buffer;
      const a = audio[trackId];
      if (!a) return undefined;
      const buffer = await audioContext().decodeAudioData(await (await fetch(a.url)).arrayBuffer());
      decoded = { trackId, buffer };
      return buffer;
    },
    [audio],
  );

  return (
    <Ctx.Provider value={{ audio, remembered, rememberedIds, outdatedIds, loading, attach, loadRemembered, forget, forgetAll, getBuffer }}>
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
