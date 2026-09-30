/// <reference lib="webworker" />
// Runs waveform analysis off the main thread so the page (and playback) stays smooth.
import { analyseBands } from '../core/analysis';

interface Request {
  id: number;
  channels: Float32Array[];
  sampleRate: number;
  peaksPerSecond: number;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<Request>) => {
  const { id, channels, sampleRate, peaksPerSecond } = e.data;
  const r = analyseBands(channels, sampleRate, peaksPerSecond);
  ctx.postMessage({ id, result: r }, [r.peaks.buffer, r.low.buffer, r.mid.buffer, r.high.buffer]);
};
