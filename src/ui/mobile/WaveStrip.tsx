import { memo, useEffect, useRef, useState } from 'react';
import { itemMixIn, type TimelineItem } from '../../core/setplan';
import type { SectionKind } from '../../core/sections';
import { useNight } from '../night';
import { useTrackWave } from '../trackWave';
import { PAD_COLORS } from './icons';
import { nightTimeOf, useNightTime } from './nightModel';

export type StripMode = 'keyframe' | 'cue' | 'loop';

/** Section colours, as on the wireframes: intro and outro grey, build blue, drops white, breakdowns pink. */
const SECTION_COLOR: Record<SectionKind, string> = {
  intro: '#8a8d96',
  outro: '#8a8d96',
  build: '#2d6bff',
  drop: '#f2f1ee',
  main: '#f2f1ee',
  breakdown: '#ffd6ea',
};
const H = 16;
const STEP = 3;

/**
 * A track's waveform under its card in the night, coloured by section, with
 * its keyframes (red diamonds), and in cue or loop mode its hot cues (flags)
 * or loops (brackets). What isn't played (before its start, after its end) is
 * dimmed. Tap to move the night there.
 */
export const WaveStrip = memo(function WaveStrip({
  it,
  mode,
  activeRegionId,
  loopIn,
}: {
  it: TimelineItem;
  mode: StripMode;
  activeRegionId?: string;
  loopIn?: number;
}) {
  const night = useNight();
  const { wave, sections } = useTrackWave(it.track?.id);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(0);
  const mixIn = itemMixIn(it);
  const dur = wave?.duration || it.track?.duration || mixIn + it.playFor;
  const x = (s: number) => (Math.max(0, Math.min(dur, s)) / dur) * w;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !w) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr);
    c.height = Math.round(H * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, H);
    const n = Math.floor(w / STEP);
    for (let i = 0; i < n; i++) {
      const t0 = (i / n) * dur;
      const t1 = ((i + 1) / n) * dur;
      const played = t1 > mixIn && t0 < mixIn + it.playFor;
      let amp = 0.12;
      if (wave) {
        const a = Math.floor(t0 * wave.peaksPerSecond);
        const b = Math.max(a + 1, Math.floor(t1 * wave.peaksPerSecond));
        amp = 0;
        for (let k = a; k < b && k < wave.peaks.length; k++) amp = Math.max(amp, wave.peaks[k]);
      }
      const kind = sections.find((s) => t0 >= s.start - 0.01 && t0 < s.end)?.kind;
      g.globalAlpha = played ? 0.9 : 0.3;
      g.fillStyle = wave ? (kind ? SECTION_COLOR[kind] : '#c9cdd4') : '#3a3a3f';
      const h = Math.max(2, Math.min(H - 2, amp * (H - 2)));
      const bx = i * STEP + 1;
      g.beginPath();
      g.roundRect(bx, (H - h) / 2, 1.6, h, 0.8);
      g.fill();
    }
  }, [wave, sections, w, dur, mixIn, it.playFor]);

  const regions = it.entry.fx ?? [];
  const cues = it.track?.cues ?? [];
  const seek = (clientX: number) => {
    const el = box.current;
    if (!el || !w) return;
    const s = ((clientX - el.getBoundingClientRect().left) / w) * dur;
    night.seek(nightTimeOf(it, Math.max(mixIn, Math.min(mixIn + it.playFor - 0.05, s))));
  };
  const kfCount = regions.reduce((n, r) => n + (r.to === undefined ? 1 : 2), 0);

  return (
    <div
      ref={box}
      className="m-wave"
      role="img"
      aria-label={`waveform with keyframes at ${kfCount} points`}
      onClick={(e) => seek(e.clientX)}
    >
      <canvas ref={canvas} style={{ width: w, height: H }} />
      {w > 0 && (
        <svg className="m-wave-marks" width={w} height={H} viewBox={`0 0 ${w} ${H}`} aria-hidden="true">
          {regions.map((r) => {
            const active = r.id === activeRegionId;
            const a = x(r.from);
            const b = r.to !== undefined ? x(r.to) : undefined;
            const col = active ? '#ff5c5c' : '#ff2e2e';
            return (
              <g key={r.id} data-region={r.id}>
                {b !== undefined && <rect x={a} y={H - 2} width={Math.max(0, b - a)} height={2} fill={col} fillOpacity={active ? 0.55 : 0.3} />}
                {[a, b].filter((v): v is number => v !== undefined).map((v, i) => (
                  <g key={i}>
                    <path d={`M${v} 0v${H}`} stroke={col} strokeWidth={1} />
                    <path d={`M${v} -1l3.5 3.5l-3.5 3.5l-3.5-3.5z`} fill={col} />
                  </g>
                ))}
              </g>
            );
          })}
          {mode === 'cue' &&
            cues
              .filter((c) => c.slot !== null && c.slot < 8)
              .map((c) => {
                const v = x(c.start);
                const col = PAD_COLORS[c.slot!];
                return (
                  <g key={c.id} data-cue={c.slot! + 1}>
                    <path d={`M${v} -2V${H}`} stroke={col} strokeWidth={1.5} />
                    <path d={`M${v} -2h6l-1.8 2.5 1.8 2.5h-6z`} fill={col} />
                  </g>
                );
              })}
          {mode === 'loop' &&
            cues
              .filter((c) => c.kind === 'loop' && c.end !== undefined)
              .map((c) => {
                const a = x(c.start);
                const b = x(c.end!);
                return (
                  <g key={c.id} data-loop={c.id}>
                    <rect x={a} y={-1} width={Math.max(1, b - a)} height={H + 2} fill="#2d6bff" fillOpacity={0.18} />
                    <path d={`M${a + 4} -1h-4v${H + 2}h4M${b - 4} -1h4v${H + 2}h-4`} stroke="#3b82f6" strokeWidth={1.5} fill="none" />
                  </g>
                );
              })}
          {mode === 'loop' && loopIn !== undefined && <path d={`M${x(loopIn) + 4} -1h-4v${H + 2}h4`} stroke="#a855f7" strokeWidth={1.5} fill="none" />}
        </svg>
      )}
      <Playhead it={it} x={x} />
    </div>
  );
});

/** Where the night is, on the track playing now. */
function Playhead({ it, x }: { it: TimelineItem; x: (s: number) => number }) {
  const t = useNightTime();
  if (t < it.startsAt || t >= it.startsAt + it.playFor) return null;
  return <div className="m-playhead" style={{ transform: `translateX(${x(itemMixIn(it) + (t - it.startsAt))}px)` }} />;
}
