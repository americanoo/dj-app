import { useRef } from 'react';

/**
 * A small rotary knob, 0–1. Drag up / down (or scroll) to turn it, double-click
 * to return to the default, arrow keys when focused.
 */
export function Knob({
  value,
  onChange,
  label,
  title,
  defaultValue = 0.5,
  format = (v) => `${Math.round(v * 100)}%`,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  title?: string;
  defaultValue?: number;
  format?: (v: number) => string;
}) {
  const drag = useRef<{ y: number; v: number } | null>(null);
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  // 270° sweep, from bottom-left round to bottom-right.
  const angle = -135 + value * 270;
  const r = 10;
  const arc = (a: number) => {
    const rad = ((a - 90) * Math.PI) / 180;
    return [12 + r * Math.cos(rad), 12 + r * Math.sin(rad)];
  };
  const [sx, sy] = arc(-135);
  const [ex, ey] = arc(angle);
  const large = value * 270 > 180 ? 1 : 0;

  return (
    <span
      className="knob"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      title={`${title ?? label}: ${format(value)} · drag, scroll or arrow keys; double-click to reset`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY, v: value };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) onChange(clamp(d.v + (d.y - e.clientY) / 120));
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={() => onChange(defaultValue)}
      onWheel={(e) => onChange(clamp(value - Math.sign(e.deltaY) * 0.05))}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          onChange(clamp(value + 0.05));
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
          e.preventDefault();
          e.stopPropagation();
          onChange(clamp(value - 0.05));
        }
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="10" className="knob-track" />
        {value > 0.001 && <path d={`M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`} className="knob-arc" />}
        <line x1="12" y1="12" x2={12 + 6 * Math.cos(((angle - 90) * Math.PI) / 180)} y2={12 + 6 * Math.sin(((angle - 90) * Math.PI) / 180)} className="knob-pointer" />
      </svg>
      <span className="knob-label">{label}</span>
    </span>
  );
}
