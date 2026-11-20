import { useEffect, useState } from 'react';
import { CUE_COLORS, SLOT_LETTERS, type Cue } from '../core/model';
import { formatTime, parseTime, round } from '../core/time';

export function CueForm({
  cue,
  beat,
  occupied,
  onChange,
  onSlotChange,
  onDelete,
  onJump,
  onSetToPlayhead,
}: {
  cue: Cue;
  beat: number | undefined;
  occupied: (Cue | undefined)[];
  onChange: (patch: Partial<Cue>) => void;
  onSlotChange: (slot: number | null) => void;
  onDelete: () => void;
  onJump: () => void;
  onSetToPlayhead: () => void;
}) {
  const [startText, setStartText] = useState(formatTime(cue.start));
  useEffect(() => setStartText(formatTime(cue.start)), [cue.start]);
  const loopBeats = cue.end !== undefined && beat ? round((cue.end - cue.start) / beat, 3) : undefined;

  const nudge = (sec: number) => {
    const start = round(Math.max(0, cue.start + sec), 3);
    onChange({ start, end: cue.end !== undefined ? round(cue.end + (start - cue.start), 3) : undefined });
  };

  return (
    <div className="cue-form">
      <div className="row">
        <label className="grow">
          Name
          <input value={cue.name} placeholder="e.g. Vocal in, Drop, Outro" onChange={(e) => onChange({ name: e.target.value })} autoFocus />
        </label>
        <label>
          Pad
          <select value={cue.slot ?? ''} onChange={(e) => onSlotChange(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">Memory</option>
            {SLOT_LETTERS.map((l, i) => (
              <option key={l} value={i}>
                {l}
                {occupied[i] ? ' (replace)' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row">
        <label>
          Start
          <input
            value={startText}
            onChange={(e) => setStartText(e.target.value)}
            onBlur={() => {
              const s = parseTime(startText);
              if (s !== undefined) nudge(s - cue.start);
              else setStartText(formatTime(cue.start));
            }}
          />
        </label>
        {cue.kind === 'loop' && (
          <label>
            Length (beats)
            <input
              type="number"
              min={0.03125}
              step="any"
              value={loopBeats ?? ''}
              disabled={!beat}
              onChange={(e) => {
                const b = Number(e.target.value);
                if (beat && b > 0) onChange({ end: round(cue.start + b * beat, 3) });
              }}
            />
          </label>
        )}
        <label>
          Type
          <select
            value={cue.kind}
            onChange={(e) =>
              e.target.value === 'loop'
                ? onChange({ kind: 'loop', end: round(cue.start + (beat ?? 0.5) * 16, 3) })
                : onChange({ kind: 'cue', end: undefined })
            }
          >
            <option value="cue">Cue</option>
            <option value="loop">Loop</option>
          </select>
        </label>
      </div>
      <div className="row wrap">
        <span className="muted">Nudge</span>
        {beat && (
          <>
            <button className="small" onClick={() => nudge(-beat * 4)}>−bar</button>
            <button className="small" onClick={() => nudge(-beat)}>−beat</button>
          </>
        )}
        <button className="small" onClick={() => nudge(-0.01)}>−10ms</button>
        <button className="small" onClick={() => nudge(0.01)}>+10ms</button>
        {beat && (
          <>
            <button className="small" onClick={() => nudge(beat)}>+beat</button>
            <button className="small" onClick={() => nudge(beat * 4)}>+bar</button>
          </>
        )}
      </div>
      <div className="row wrap">
        <span className="muted">Colour</span>
        {CUE_COLORS.map((c) => (
          <button
            key={c}
            className={`swatch-btn ${cue.color === c ? 'active' : ''}`}
            style={{ background: c }}
            onClick={() => onChange({ color: c })}
            aria-label={`Colour ${c}`}
          />
        ))}
        <input type="color" value={cue.color} onChange={(e) => onChange({ color: e.target.value })} aria-label="Custom colour" />
      </div>
      <div className="row">
        <button className="small" onClick={onJump}>Jump to</button>
        <button className="small" onClick={onSetToPlayhead}>Move to playhead</button>
        <span className="grow" />
        <button className="small danger" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}
