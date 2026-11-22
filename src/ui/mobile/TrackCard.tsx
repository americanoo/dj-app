import { useEffect, useState, type ReactNode } from 'react';
import { normaliseKey, parseKey, toCamelot } from '../../core/keys';
import { parseSheetTime } from '../../core/sheet';
import { END_FX, type EndFx } from '../../core/trackfx';
import { mmss } from './nightModel';

/**
 * One track as a card, as on the wireframes: title, key (red) and BPM (blue);
 * artist and start time; the end-time effects (eo / fo / kl) and end time.
 * Key, BPM and times are typed in place. The left and right slots hold the
 * drag handle and the round button.
 */
export function TrackCard({
  title,
  artist,
  keyName,
  bpm,
  start,
  end,
  endFx,
  onKey,
  onBpm,
  onStart,
  onEnd,
  onEndFx,
  left,
  right,
  className = '',
  keyHint,
}: {
  title: string;
  artist: string;
  keyName?: string;
  bpm?: number;
  start: number;
  end?: number;
  endFx: EndFx[];
  onKey: (key: string | undefined) => void;
  onBpm: (bpm: number | undefined) => void;
  onStart: (s: number | undefined) => void;
  onEnd: (s: number | undefined) => void;
  onEndFx: (fx: EndFx[]) => void;
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
  /** Shown after the key when it plays in another one (key matching). */
  keyHint?: string;
}) {
  return (
    <div className={`m-card ${left ? 'with-left' : ''} ${className}`}>
      {left && <div className="m-card-left">{left}</div>}
      <div className="m-card-grid">
        <div className="m-title" title={title}>
          {title || 'Untitled'}
        </div>
        <div className="m-keybpm">
          <TextField
            className="m-key"
            label="key"
            value={toCamelot(keyName) ?? keyName ?? ''}
            placeholder="--"
            width={3}
            onCommit={(v) => onKey(v ? (parseKey(v) ? normaliseKey(v) : v) : undefined)}
          />
          {keyHint && <span className="m-keyhint">→{keyHint}</span>}
          <span className="m-bpm">
            <TextField
              className="m-bpm-val"
              label="bpm"
              value={bpm ? String(Math.round(bpm * 10) / 10) : ''}
              placeholder="---"
              width={bpm && bpm % 1 ? 5 : 3}
              numeric
              onCommit={(v) => {
                const n = Number(v.replace(',', '.'));
                onBpm(v && Number.isFinite(n) && n > 30 && n < 300 ? n : undefined);
              }}
            />{' '}
            bpm
          </span>
        </div>
        <div className="m-artist" title={artist}>
          {artist || '—'}
        </div>
        <label className="m-time">
          start
          <TimeField label="start time" value={start} onCommit={onStart} />
        </label>
        <div className="m-fx">
          {END_FX.map((f) => {
            const on = endFx.includes(f.id);
            return (
              <button
                key={f.id}
                type="button"
                className={`m-fx-btn${on ? ' on' : ''}`}
                aria-pressed={on}
                aria-label={f.label}
                title={f.label}
                onClick={() => onEndFx(on ? endFx.filter((x) => x !== f.id) : [...endFx, f.id])}
              >
                {f.short}
              </button>
            );
          })}
        </div>
        <label className="m-time">
          end
          <TimeField label="end time" value={end} onCommit={onEnd} />
        </label>
      </div>
      {right && <div className="m-card-right">{right}</div>}
    </div>
  );
}

/** A time typed as minutes:seconds ("2:08", or "208" on the number pad). Empty clears it. */
export function TimeField({ label, value, onCommit }: { label: string; value: number | undefined; onCommit: (v: number | undefined) => void }) {
  return (
    <TextField
      className="m-time-val"
      label={label}
      value={mmss(value)}
      width={5}
      numeric
      onCommit={(text) => {
        if (!text.trim()) return onCommit(undefined);
        const v = parseSheetTime(text);
        if (v !== undefined) onCommit(v);
        return v !== undefined;
      }}
    />
  );
}

/** Text edited in place: saved on Enter or leaving the field; Escape puts it back. */
function TextField({
  value,
  label,
  onCommit,
  className,
  width,
  placeholder,
  numeric = false,
}: {
  value: string;
  label: string;
  onCommit: (v: string) => void | boolean;
  className: string;
  width: number;
  placeholder?: string;
  numeric?: boolean;
}) {
  const [text, setText] = useState(value);
  const [editing, setEditing] = useState(false);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);
  return (
    <input
      className={`m-field ${className}${bad ? ' bad' : ''}`}
      aria-label={label}
      value={text}
      placeholder={placeholder}
      style={{ width: `calc(${width}ch + 3px)` }}
      inputMode={numeric ? 'decimal' : 'text'}
      enterKeyHint="done"
      autoComplete="off"
      autoCapitalize="characters"
      spellCheck={false}
      onFocus={(e) => {
        setEditing(true);
        e.target.select();
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (text.trim() === value) return;
        if (onCommit(text.trim()) === false) {
          setBad(true);
          window.setTimeout(() => setBad(false), 900);
          setText(value);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(value);
          setEditing(false);
          window.setTimeout(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}
