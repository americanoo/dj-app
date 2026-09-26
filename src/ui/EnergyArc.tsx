import type { SetPlan } from '../core/model';
import { totalSeconds, type TimelineItem } from '../core/setplan';
import { formatTime } from '../core/time';

const W = 1000;
const H = 220;
const PAD = { l: 34, r: 12, t: 14, b: 26 };

export function EnergyArc({ set, timeline }: { set: SetPlan; timeline: TimelineItem[] }) {
  const total = Math.max(totalSeconds(timeline), set.targetMinutes * 60, 60);
  const x = (s: number) => PAD.l + (s / total) * (W - PAD.l - PAD.r);
  const y = (e: number) => PAD.t + (1 - (e - 1) / 9) * (H - PAD.t - PAD.b);
  const chapterColor = new Map(set.chapters.map((c) => [c.id, c.color]));

  // Contiguous chapter bands.
  const bands: { color: string; name: string; from: number; to: number }[] = [];
  for (const it of timeline) {
    const color = chapterColor.get(it.entry.chapterId) ?? '#888';
    const name = set.chapters.find((c) => c.id === it.entry.chapterId)?.name ?? '';
    const last = bands[bands.length - 1];
    if (last && last.name === name) last.to = it.startsAt + it.playFor;
    else bands.push({ color, name, from: it.startsAt, to: it.startsAt + it.playFor });
  }

  const pts = timeline.map((it) => ({ px: x(it.startsAt + it.playFor / 2), py: y(it.entry.energy), it }));
  const path = smoothPath(pts.map((p) => [p.px, p.py]));
  const area = pts.length ? `${path} L ${pts[pts.length - 1].px} ${y(1)} L ${pts[0].px} ${y(1)} Z` : '';

  const minuteStep = total > 3 * 3600 ? 60 : total > 3600 ? 30 : 15;
  const ticks: number[] = [];
  for (let m = 0; m * 60 <= total; m += minuteStep) ticks.push(m * 60);

  return (
    <svg className="energy-arc" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Energy arc of the set">
      <defs>
        <linearGradient id="arcFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {bands.map((b, i) => (
        <g key={i}>
          <rect x={x(b.from)} y={PAD.t} width={Math.max(1, x(b.to) - x(b.from))} height={H - PAD.t - PAD.b} fill={b.color} opacity={0.1} />
          <text x={x(b.from) + 6} y={PAD.t + 14} className="arc-band-label" fill={b.color}>
            {b.name}
          </text>
        </g>
      ))}
      {[1, 4, 7, 10].map((e) => (
        <g key={e}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(e)} y2={y(e)} className="arc-grid" />
          <text x={PAD.l - 8} y={y(e) + 4} textAnchor="end" className="arc-axis">
            {e}
          </text>
        </g>
      ))}
      {ticks.map((t) => (
        <text key={t} x={x(t)} y={H - 6} textAnchor="middle" className="arc-axis">
          {formatTime(t, false).replace(/:00$/, "'")}
        </text>
      ))}
      <line x1={x(set.targetMinutes * 60)} x2={x(set.targetMinutes * 60)} y1={PAD.t} y2={H - PAD.b} className="arc-target">
        <title>Target length</title>
      </line>
      {area && <path d={area} fill="url(#arcFill)" />}
      {path && <path d={path} className="arc-line" />}
      {pts.map(({ px, py, it }, i) => (
        <g key={it.entry.id}>
          <circle cx={px} cy={py} r={it.warnings.length ? 6 : 4.5} className={it.warnings.length ? 'arc-pt warn' : 'arc-pt'} fill={chapterColor.get(it.entry.chapterId)}>
            <title>
              {`${i + 1}. ${it.track ? `${it.track.artist} – ${it.track.title}` : 'Missing'}\nEnergy ${it.entry.energy} @ ${formatTime(it.startsAt, false)}${it.warnings.length ? '\n⚠ ' + it.warnings.join('\n⚠ ') : ''}`}
            </title>
          </circle>
        </g>
      ))}
      {!pts.length && (
        <text x={W / 2} y={H / 2} textAnchor="middle" className="arc-axis">
          Add tracks to see the arc of your set
        </text>
      )}
    </svg>
  );
}

/** Catmull-Rom → cubic Bézier for a gentle curve through the points. */
function smoothPath(points: [number, number][]): string {
  if (!points.length) return '';
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}
