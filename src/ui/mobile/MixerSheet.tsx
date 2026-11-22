import type { StemKey } from '../../core/trackfx';
import { stemsAt } from '../../core/trackfx';
import type { TimelineItem } from '../../core/setplan';
import { useNight } from '../night';
import { useStore } from '../store';
import { mmss, nightTimeOf, songPos, useNightTime } from './nightModel';

/** Moving a slider within this long of a keyframe changes it instead of adding one. */
const NEAR = 0.75;

/**
 * The mixer: vocals and instrumental levels for the track playing now. Moving
 * a slider sets a keyframe where the night is, so the levels can change through
 * the song (vocals out for the drop, back in for the outro). Until real stems
 * (lalal.ai, in the paid version) it's previewed with EQ.
 */
export function MixerSheet({ it, onClose }: { it: TimelineItem; onClose: () => void }) {
  const { dispatch } = useStore();
  const night = useNight();
  const t = useNightTime();
  const s = songPos(it, t);
  const keys = [...(it.entry.stems ?? [])].sort((a, b) => a.t - b.t);
  const now = stemsAt(keys, s);
  const write = (stems: StemKey[]) => dispatch({ type: 'updateEntry', id: it.entry.id, patch: { stems: stems.length ? stems : undefined } });
  const set = (patch: Partial<Omit<StemKey, 't'>>) => {
    const near = keys.find((k) => Math.abs(k.t - s) < NEAR);
    write(near ? keys.map((k) => (k === near ? { ...k, ...patch } : k)) : [...keys, { t: s, ...now, ...patch }]);
  };
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const mode = now.vocals >= 0.99 && now.inst >= 0.99 ? 'full' : now.inst <= 0.01 ? 'vocals' : now.vocals <= 0.01 ? 'inst' : '';

  return (
    <div className="m-sheet" role="dialog" aria-label="Mixer">
      <header className="m-sheet-head">
        <h2>MIXER</h2>
        <span className="m-muted">
          {it.track?.title} @ {mmss(s)}
        </span>
        <span className="grow" />
        <button className="m-chip" onClick={onClose}>
          done
        </button>
      </header>
      <div className="m-modes">
        <button className={mode === 'full' ? 'on' : ''} onClick={() => set({ vocals: 1, inst: 1 })}>
          full
        </button>
        <button className={mode === 'vocals' ? 'on' : ''} onClick={() => set({ vocals: 1, inst: 0 })}>
          vocals mode
        </button>
        <button className={mode === 'inst' ? 'on' : ''} onClick={() => set({ vocals: 0, inst: 1 })}>
          instrumental mode
        </button>
      </div>
      <label className="m-slider pink">
        <span>vocals</span>
        <input type="range" min={0} max={1} step={0.01} value={now.vocals} aria-label="vocals level" onChange={(e) => set({ vocals: Number(e.target.value) })} />
        <b>{pct(now.vocals)}</b>
      </label>
      <label className="m-slider blue">
        <span>instrumental</span>
        <input type="range" min={0} max={1} step={0.01} value={now.inst} aria-label="instrumental level" onChange={(e) => set({ inst: Number(e.target.value) })} />
        <b>{pct(now.inst)}</b>
      </label>
      {keys.length > 0 && (
        <ul className="m-keys" aria-label="level keyframes">
          {keys.map((k) => (
            <li key={k.t}>
              <button className="m-key-t" onClick={() => night.seek(nightTimeOf(it, k.t))} title="go there">
                ◆ {mmss(k.t)}
              </button>
              <span>
                v {pct(k.vocals)} · i {pct(k.inst)}
              </span>
              <button className="m-x" aria-label={`remove the keyframe at ${mmss(k.t)}`} onClick={() => write(keys.filter((x) => x !== k))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="m-note">Moving a slider sets a keyframe where the night is. Previewed with EQ until real stems arrive (lalal.ai, in the paid version).</p>
    </div>
  );
}
