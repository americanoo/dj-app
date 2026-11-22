/** Types for the vendored Signalsmith Stretch (see signalsmith-stretch.mjs). */
/** One change on the stretch node's timeline (see the package README; `outputTime` is when it applies). */
export interface StretchSchedule {
  outputTime?: number;
  active?: boolean;
  input?: number;
  rate?: number;
  semitones?: number;
  tonalityHz?: number;
  loopStart?: number;
  loopEnd?: number;
}
export interface StretchNode extends AudioWorkletNode {
  inputTime: number;
  schedule(change: StretchSchedule): Promise<unknown>;
  addBuffers(channels: Float32Array[], transfer?: Transferable[]): Promise<number>;
  dropBuffers(toSeconds?: number): Promise<unknown>;
  start(when?: number): Promise<unknown>;
  stop(when?: number): Promise<unknown>;
  latency(): Promise<number>;
}
export default function SignalsmithStretch(ctx: BaseAudioContext, options?: AudioWorkletNodeOptions): Promise<StretchNode>;
