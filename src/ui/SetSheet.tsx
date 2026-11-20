import { useEffect, useMemo, useState } from 'react';
import { keyColor, toCamelot } from '../core/keys';
import { BLEND_STYLES, TEMPO_MODES, tempoMode, type BlendStyle, type TempoMode } from '../core/mixplan';
import { SLOT_LETTERS, type Cue, type SetEntry } from '../core/model';
import { buildTimeline, endLoopOf, itemMixIn, nightSlots, slotKey, type TimelineItem } from '../core/setplan';
import { SHEET_FX, formatShort, fxIsOn, newCue, parseSheetTime, setMixPoint, withFx } from '../core/sheet';
import { useNight } from './night';
import { KeyLockButton } from './NightBar';
import { activeSet, useStore } from './store';

/**
 * The Sheet: the night as a list of numbers. Every track with where it starts
 * and ends (in the night and in the song), its cues and loops, and between
 * tracks the transition: when the next one comes in, the blend, and FX on or
 * off. No waveforms, so it suits DJs who know their marks, and phones.
 */
export function SetSheet({ onTimeline }: { onTimeline?: () => void }) {
  const { project, dispatch } = useStore();
  const night = useNight();
  const set = activeSet(project);
  const items = useMemo(() => buildTimeline(set, project.library), [set, project.library]);
  const end = items.reduce((e, it) => Math.max(e, it.startsAt + it.playFor), 0);
  // Keys as they'll play, after any key matching.
  const playKeys = useMemo(() => {
    const m = new Map<string, { key?: string; semitones: number }>();
    for (const s of nightSlots(items)) m.set(s.id, { key: slotKey(s), semitones: s.semitones ?? 0 });
    return m;
  }, [items]);

  const setCues = (trackId: string, cues: Cue[]) => dispatch({ type: 'setCues', trackId, cues });
  const updateEntry = (id: string, patch: Partial<SetEntry>) => dispatch({ type: 'updateEntry', id, patch });
  const mixPoint = (it: TimelineItem, which: 'in' | 'out', at: number | undefined) => {
    if (!it.track) return;
    const { cues, patch } = setMixPoint(it.track, it.entry, which, at, set.entries);
    if (cues !== it.track.cues) setCues(it.track.id, cues);
    if (Object.keys(patch).length) updateEntry(it.entry.id, patch);
  };

  return (
    <div className="sheet-pane">
      <div className="pane-head">
        <h3>Sheet</h3>
        <span className="muted small-text">
          {items.length} tracks · {formatShort(end) || '0:00'}
        </span>
        <span className="grow" />
        <KeyLockButton />
        {onTimeline && (
          <button className="small" onClick={onTimeline} title="Back to the timeline with waveforms">
            ◐ Timeline
          </button>
        )}
      </div>
      {!items.length ? (
        <p className="muted sheet-empty">No tracks in the night yet. Add some from the Library with “+ Set”.</p>
      ) : (
        <div className="sheet-list">
          <p className="muted small-text sheet-hint">
            Times are minutes:seconds. Type <code>2:08</code>, or just <code>208</code> on the number pad.
          </p>
          {items.map((it, i) => (
            <div key={it.entry.id}>
              {i > 0 && (
                <SheetMix
                  a={items[i - 1]}
                  b={it}
                  onEntry={updateEntry}
                  onTime={(at) => dispatch({ type: 'setEntryTime', id: it.entry.id, at })}
                  // From just before the outgoing track ends or the next comes in, whichever is first.
                  onHear={() => night.play(Math.max(0, Math.min(it.startsAt, items[i - 1].startsAt + items[i - 1].playFor) - 8))}
                />
              )}
              <SheetTrack
                n={i + 1}
                it={it}
                playKey={playKeys.get(it.entry.id)}
                onTime={(at) => dispatch({ type: 'setEntryTime', id: it.entry.id, at })}
                onMixPoint={(which, at) => mixPoint(it, which, at)}
                onCues={(cues) => it.track && setCues(it.track.id, cues)}
                onEntry={(patch) => updateEntry(it.entry.id, patch)}
                onPlay={() => night.play(it.startsAt)}
                onRemove={() => dispatch({ type: 'removeEntry', id: it.entry.id })}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SheetTrack({
  n,
  it,
  playKey,
  onTime,
  onMixPoint,
  onCues,
  onEntry,
  onPlay,
  onRemove,
}: {
  n: number;
  it: TimelineItem;
  playKey?: { key?: string; semitones: number };
  onTime: (at: number) => void;
  onMixPoint: (which: 'in' | 'out', at: number | undefined) => void;
  onCues: (cues: Cue[]) => void;
  onEntry: (patch: Partial<SetEntry>) => void;
  onPlay: () => void;
  onRemove: () => void;
}) {
  const { track, entry } = it;
  const mixIn = itemMixIn(it);
  const mixOut = track?.cues.find((c) => c.id === entry.mixOutCueId)?.start;
  const loop = endLoopOf(entry, track);
  const loops = track?.cues.filter((c) => c.kind === 'loop' && c.end !== undefined) ?? [];
  const cues = track ? [...track.cues].sort((x, y) => x.start - y.start) : [];
  const editCue = (id: string, patch: Partial<Cue>) => track && onCues(track.cues.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  return (
    <article className="sheet-track" data-entry={entry.id}>
      <header className="sheet-track-head">
        <span className="sheet-no">{n}</span>
        <div className="sheet-title">
          <b>{track?.title ?? 'Missing track'}</b>
          <span className="muted">{track?.artist}</span>
        </div>
        <span className="sheet-meta">
          {track?.bpm ? `${track.bpm.toFixed(0)} BPM` : ''}
          {track?.key && (
            <span
              className="key-pill"
              style={{ background: keyColor(playKey?.key ?? track.key) }}
              title={playKey?.semitones ? `Key matched: ${toCamelot(track.key)} played ${playKey.semitones > 0 ? '+' : ''}${playKey.semitones} semitones` : track.key}
            >
              {toCamelot(playKey?.key ?? track.key)}
              {playKey?.semitones ? ` ${playKey.semitones > 0 ? '+' : ''}${playKey.semitones}` : ''}
            </span>
          )}
        </span>
        <button className="icon sheet-play" onClick={onPlay} title="Play the night from this track" aria-label={`Play from ${track?.title}`}>
          ▶
        </button>
        <button className="icon sheet-remove" onClick={onRemove} title="Take it out of the night" aria-label={`Remove ${track?.title}`}>
          ✕
        </button>
      </header>

      <div className="sheet-times">
        <TimeField label="Starts" sub="night" value={it.startsAt} onCommit={(v) => v !== undefined && onTime(v)} />
        <TimeField
          label="Ends"
          sub="night"
          value={it.startsAt + it.playFor}
          disabled={!!loop}
          title={loop ? 'Set by the loop it leaves on' : undefined}
          onCommit={(v) => v !== undefined && onMixPoint('out', mixIn + Math.max(1, v - it.startsAt))}
        />
        <TimeField label="From" sub="song" value={mixIn || undefined} placeholder="0:00" clearable onCommit={(v) => onMixPoint('in', v)} />
        <TimeField
          label="Until"
          sub="song"
          value={loop ? undefined : mixOut}
          placeholder={loop ? 'loop' : track?.duration ? formatShort(track.duration) : 'end'}
          clearable
          disabled={!!loop}
          onCommit={(v) => onMixPoint('out', v)}
        />
      </div>

      {loops.length > 0 && (
        <div className="sheet-loopout">
          <label>
            Leave on loop
            <select
              value={entry.endLoop?.cueId ?? ''}
              onChange={(e) =>
                onEntry({ endLoop: e.target.value ? { cueId: e.target.value, times: entry.endLoop?.times ?? 4 } : undefined })
              }
            >
              <option value="">No</option>
              {loops.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name || 'Loop'} {formatShort(l.start)}–{formatShort(l.end)}
                </option>
              ))}
            </select>
          </label>
          {entry.endLoop && (
            <label>
              ×
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={64}
                value={entry.endLoop.times}
                onChange={(e) => {
                  const times = Math.max(1, Math.min(64, Math.round(Number(e.target.value) || 1)));
                  onEntry({ endLoop: { ...entry.endLoop!, times } });
                }}
                aria-label="Times round the loop"
              />
            </label>
          )}
        </div>
      )}

      {track && (
        <details className="sheet-cues">
          <summary>
            Cues &amp; loops <span className="muted">{track.cues.length}</span>
          </summary>
          {cues.map((c) => (
            <div className="sheet-cue" key={c.id}>
              <span className="sheet-pad" style={{ background: c.color }}>
                {c.slot !== null ? SLOT_LETTERS[c.slot] : c.kind === 'loop' ? '⟲' : '•'}
              </span>
              <NameField value={c.name} placeholder={c.kind === 'loop' ? 'Loop' : 'Cue'} onCommit={(name) => editCue(c.id, { name })} />
              <TimeField value={c.start} onCommit={(v) => v !== undefined && editCue(c.id, loopMove(c, v))} />
              {c.kind === 'loop' && (
                <>
                  <span className="muted">–</span>
                  <TimeField value={c.end} onCommit={(v) => v !== undefined && v > c.start && editCue(c.id, { end: v })} />
                </>
              )}
              <button className="icon danger" onClick={() => onCues(track.cues.filter((x) => x.id !== c.id))} aria-label="Delete">
                ✕
              </button>
            </div>
          ))}
          <div className="row">
            <button className="small" onClick={() => onCues([...track.cues, newCue(track.cues, 'cue', mixIn)])}>
              + Cue
            </button>
            <button className="small" onClick={() => onCues([...track.cues, newCue(track.cues, 'loop', mixIn, track.bpm)])}>
              + Loop
            </button>
          </div>
        </details>
      )}
    </article>
  );
}

/** Moving a loop's start keeps its length. */
function loopMove(c: Cue, start: number): Partial<Cue> {
  return c.kind === 'loop' && c.end !== undefined ? { start, end: start + (c.end - c.start) } : { start };
}

function SheetMix({
  a,
  b,
  onEntry,
  onTime,
  onHear,
}: {
  a: TimelineItem;
  b: TimelineItem;
  onEntry: (id: string, patch: Partial<SetEntry>) => void;
  onTime: (at: number) => void;
  onHear: () => void;
}) {
  const overlap = a.startsAt + a.playFor - b.startsAt;
  const bar = 240 / (a.track?.bpm || b.track?.bpm || 120);
  // Where in the outgoing song the next one comes in (tempo riding aside).
  const inAtSong = itemMixIn(a) + (b.startsAt - a.startsAt);
  const entry = b.entry;
  const tempo = tempoMode(entry);
  return (
    <section className="sheet-mix" data-entry={entry.id}>
      <div className="sheet-mix-head">
        <span className="sheet-mix-icon">⇄</span>
        <span>
          <b>{b.track?.title ?? 'Next'}</b> comes in at
        </span>
        <TimeField value={inAtSong} onCommit={(v) => v !== undefined && onTime(Math.max(0, a.startsAt + (v - itemMixIn(a))))} />
        <span className="muted">
          of {a.track?.title ?? 'the last track'} ·{' '}
          {overlap > 0.5 ? `${formatShort(overlap)} together` : overlap < -0.5 ? `${formatShort(-overlap)} gap` : 'cut'}
        </span>
        <button className="small sheet-hear" onClick={onHear} title="Play from just before this transition">
          ▶ Hear
        </button>
      </div>
      <div className="sheet-mix-controls">
        <select
          value={entry.blend ?? ''}
          onChange={(e) => onEntry(entry.id, { blend: (e.target.value || undefined) as BlendStyle | undefined })}
          title="How the next track is mixed in"
          aria-label="Blend"
        >
          <option value="">Blend: auto</option>
          {BLEND_STYLES.map((s) => (
            <option key={s.id} value={s.id} title={s.hint}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          value={tempo}
          onChange={(e) => onEntry(entry.id, { tempo: e.target.value as TempoMode, sync: undefined })}
          title={TEMPO_MODES.find((m) => m.id === tempo)?.hint}
          aria-label="Tempo"
        >
          {TEMPO_MODES.map((m) => (
            <option key={m.id} value={m.id}>
              BPM: {m.label}
            </option>
          ))}
        </select>
        <button
          className="small"
          aria-pressed={!!entry.matchKey}
          onClick={() => onEntry(entry.id, { matchKey: !entry.matchKey })}
          title="Transpose the incoming track so it mixes smoothly with the key the outgoing one plays in"
        >
          Match key
        </button>
        {SHEET_FX.map((f) => {
          const on = fxIsOn(entry.automation, f.id);
          return (
            <button
              key={f.id}
              className="small sheet-fx"
              aria-pressed={on}
              title={f.hint}
              onClick={() => onEntry(entry.id, { automation: withFx(entry.automation, f.id, !on, overlap, bar) })}
            >
              {f.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** A time, typed. Commits on Enter or leaving the field; an unreadable entry goes back to what it was. */
function TimeField({
  label,
  sub,
  value,
  onCommit,
  placeholder,
  clearable = false,
  disabled = false,
  title,
}: {
  label?: string;
  sub?: string;
  value: number | undefined;
  onCommit: (v: number | undefined) => void;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  const shown = formatShort(value);
  const [text, setText] = useState(shown);
  const [bad, setBad] = useState(false);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(shown);
  }, [shown, editing]);

  const commit = () => {
    setEditing(false);
    if (text.trim() === shown) return;
    if (!text.trim()) {
      if (clearable) onCommit(undefined);
      else setText(shown);
      return;
    }
    const v = parseSheetTime(text);
    if (v === undefined) {
      setBad(true);
      window.setTimeout(() => setBad(false), 900);
      setText(shown);
      return;
    }
    onCommit(v);
  };

  const input = (
    <input
      className={`time-field${bad ? ' bad' : ''}`}
      type="text"
      inputMode="decimal"
      enterKeyHint="done"
      autoComplete="off"
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      title={title}
      aria-label={label ? `${label} (${sub})` : undefined}
      onFocus={(e) => {
        setEditing(true);
        e.target.select();
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(shown);
          setEditing(false);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
  if (!label) return input;
  return (
    <label className="sheet-time">
      <span className="sheet-time-label">
        {label} <small>{sub}</small>
      </span>
      {input}
    </label>
  );
}

/** A cue's name: saved when you leave the field (one undo step, not one per letter). */
function NameField({ value, placeholder, onCommit }: { value: string; placeholder: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className="sheet-cue-name"
      value={text}
      placeholder={placeholder}
      enterKeyHint="done"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

