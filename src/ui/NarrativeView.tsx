import { useMemo, useState } from 'react';
import { toCamelot, type KeyRelation } from '../core/keys';
import { SLOT_LETTERS, type SetPlan } from '../core/model';
import { buildTimeline, totalSeconds, type TimelineItem } from '../core/setplan';
import { formatTime } from '../core/time';
import { EnergyArc } from './EnergyArc';
import { activeSet, useStore } from './store';

const RELATION_LABEL: Record<KeyRelation, string> = {
  same: 'same key',
  adjacent: 'harmonic ±1',
  relative: 'relative maj/min',
  diagonal: 'diagonal mix',
  boost: 'energy boost',
  clash: '',
  unknown: '',
};

function insertionIndex(set: SetPlan, chapterId: string): number {
  const order = set.chapters.findIndex((c) => c.id === chapterId);
  return set.entries.filter((e) => set.chapters.findIndex((c) => c.id === e.chapterId) <= order).length;
}

export function NarrativeView({ onOpenCues, onGoLibrary }: { onOpenCues: (id: string) => void; onGoLibrary: () => void }) {
  const { project, dispatch } = useStore();
  const set = activeSet(project);
  const timeline = useMemo(() => buildTimeline(set, project.library), [set, project.library]);
  const total = totalSeconds(timeline);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const drop = (toIndex: number, chapterId: string) => {
    if (dragId) dispatch({ type: 'moveEntry', id: dragId, toIndex, chapterId });
    setDragId(null);
    setDropTarget(null);
  };

  const overUnder = total / 60 - set.targetMinutes;

  return (
    <div className="narrative">
      <section className="set-meta card">
        <div className="row">
          <label className="grow">
            Set name
            <input value={set.name} onChange={(e) => dispatch({ type: 'updateSet', patch: { name: e.target.value } })} />
          </label>
          <label className="grow">
            Venue / occasion
            <input
              value={set.venue}
              placeholder="e.g. Closing set, Warehouse 12, 3am"
              onChange={(e) => dispatch({ type: 'updateSet', patch: { venue: e.target.value } })}
            />
          </label>
          <label>
            Target (min)
            <input
              type="number"
              min={5}
              max={720}
              value={set.targetMinutes}
              onChange={(e) => dispatch({ type: 'updateSet', patch: { targetMinutes: Number(e.target.value) || 60 } })}
            />
          </label>
          <div className="stat">
            <span className="stat-label">Planned</span>
            <span className={Math.abs(overUnder) > 10 ? 'stat-value warn' : 'stat-value'}>
              {formatTime(total, false)}
            </span>
          </div>
          <button
            className="danger small"
            onClick={() => confirm(`Delete set "${set.name}"?`) && dispatch({ type: 'deleteSet', id: set.id })}
          >
            Delete set
          </button>
        </div>
        <label>
          The story you want to tell
          <textarea
            rows={3}
            value={set.story}
            placeholder="Where do you want to take the room? e.g. Start dubby and patient, let the percussion carry the build, one vocal moment at the peak, end on something euphoric but gentle."
            onChange={(e) => dispatch({ type: 'updateSet', patch: { story: e.target.value } })}
          />
        </label>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Energy arc</h3>
          <span className="muted">Planned energy per track across the set, coloured by chapter</span>
        </div>
        <EnergyArc set={set} timeline={timeline} />
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Chapters</h3>
          <button className="small" onClick={() => dispatch({ type: 'addChapter' })}>
            + Chapter
          </button>
        </div>
        <div className="chapters">
          {set.chapters.map((c, i) => (
            <div key={c.id} className="chapter-edit" style={{ borderColor: c.color }}>
              <div className="row">
                <input
                  type="color"
                  value={c.color}
                  aria-label="Chapter colour"
                  onChange={(e) => dispatch({ type: 'updateChapter', id: c.id, patch: { color: e.target.value } })}
                />
                <input
                  className="grow strong"
                  value={c.name}
                  aria-label="Chapter name"
                  onChange={(e) => dispatch({ type: 'updateChapter', id: c.id, patch: { name: e.target.value } })}
                />
                <button className="icon" disabled={i === 0} onClick={() => dispatch({ type: 'moveChapter', id: c.id, delta: -1 })} title="Move earlier">
                  ←
                </button>
                <button
                  className="icon"
                  disabled={i === set.chapters.length - 1}
                  onClick={() => dispatch({ type: 'moveChapter', id: c.id, delta: 1 })}
                  title="Move later"
                >
                  →
                </button>
                <button
                  className="icon"
                  disabled={set.chapters.length <= 1}
                  onClick={() => dispatch({ type: 'removeChapter', id: c.id })}
                  title="Remove chapter (tracks move to the previous one)"
                >
                  ×
                </button>
              </div>
              <textarea
                rows={2}
                value={c.intent}
                placeholder="What should the crowd feel here?"
                onChange={(e) => dispatch({ type: 'updateChapter', id: c.id, patch: { intent: e.target.value } })}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Running order</h3>
          <span className="muted">Drag tracks to reorder or move them between chapters</span>
        </div>
        {!set.entries.length && (
          <div className="empty-inline">
            No tracks yet. <button className="link" onClick={onGoLibrary}>Add some from your library →</button>
          </div>
        )}
        {set.chapters.map((c) => {
          const items = timeline.filter((it) => it.entry.chapterId === c.id);
          const endIdx = insertionIndex(set, c.id);
          return (
            <div key={c.id} className="chapter-group">
              <div className="chapter-title" style={{ color: c.color }}>
                {c.name}
                <span className="muted">
                  {' '}
                  · {items.length} tracks · {formatTime(items.reduce((n, it) => n + it.playFor, 0), false)}
                </span>
              </div>
              {items.map((it) => (
                <EntryRow
                  key={it.entry.id}
                  item={it}
                  index={timeline.indexOf(it)}
                  set={set}
                  dragging={dragId === it.entry.id}
                  dropping={dropTarget === it.entry.id}
                  onDragStart={() => setDragId(it.entry.id)}
                  onDragEnd={() => {
                    setDragId(null);
                    setDropTarget(null);
                  }}
                  onDragOver={() => setDropTarget(it.entry.id)}
                  onDrop={() => drop(set.entries.findIndex((e) => e.id === it.entry.id), c.id)}
                  onOpenCues={onOpenCues}
                />
              ))}
              <div
                className={`drop-end ${dropTarget === 'end-' + c.id ? 'over' : ''} ${dragId ? 'visible' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDropTarget('end-' + c.id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(endIdx, c.id);
                }}
              >
                {dragId ? `Drop at end of ${c.name}` : ''}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function EntryRow(props: {
  item: TimelineItem;
  index: number;
  set: SetPlan;
  dragging: boolean;
  dropping: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onOpenCues: (id: string) => void;
}) {
  const { dispatch } = useStore();
  const { item, index, set } = props;
  const { entry, track } = item;
  const update = (patch: Partial<typeof entry>) => dispatch({ type: 'updateEntry', id: entry.id, patch });
  const cueLabel = (id: string) => {
    const c = track?.cues.find((x) => x.id === id);
    if (!c) return '';
    return `${c.slot !== null ? SLOT_LETTERS[c.slot] : 'Mem'} ${formatTime(c.start, false)}${c.name ? ' ' + c.name : ''}`;
  };
  const cues = track ? [...track.cues].sort((a, b) => a.start - b.start) : [];

  return (
    <>
      {index > 0 && (
        <div className={`transition-hint ${item.warnings.length ? 'bad' : ''}`}>
          <span>{RELATION_LABEL[item.keyRelation]}</span>
          {item.bpmDelta !== undefined && Math.abs(item.bpmDelta) >= 0.05 && (
            <span>
              {item.bpmDelta > 0 ? '+' : ''}
              {item.bpmDelta.toFixed(1)}% BPM
            </span>
          )}
          {item.warnings.map((w) => (
            <span key={w} className="warn">
              ⚠ {w}
            </span>
          ))}
        </div>
      )}
      <div
        className={`entry ${props.dragging ? 'dragging' : ''} ${props.dropping ? 'drop-before' : ''}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', entry.id);
          props.onDragStart();
        }}
        onDragEnd={props.onDragEnd}
        onDragOver={(e) => {
          e.preventDefault();
          props.onDragOver();
        }}
        onDrop={(e) => {
          e.preventDefault();
          props.onDrop();
        }}
      >
        <div className="entry-main">
          <span className="handle" title="Drag to reorder">
            ⋮⋮
          </span>
          <span className="idx">{index + 1}</span>
          <span className="time muted" title={item.estimated ? 'Estimated: set a mix-out cue for precision' : ''}>
            {formatTime(item.startsAt, false)}
            {item.estimated ? '~' : ''}
          </span>
          <button className="entry-title link" onClick={() => track && props.onOpenCues(track.id)} title="Edit cues & loops">
            <b>{track?.artist ?? 'Missing track'}</b> – {track?.title}
          </button>
          <span className="chips">
            {track?.bpm && <span className="chip">{track.bpm.toFixed(1)}</span>}
            {track?.key && <span className="chip key">{toCamelot(track.key) ?? track.key}</span>}
          </span>
          <label className="energy" title="Planned energy">
            <input
              type="range"
              min={1}
              max={10}
              value={entry.energy}
              onChange={(e) => update({ energy: Number(e.target.value) })}
            />
            <span className="energy-val">{entry.energy}</span>
          </label>
          <select
            value={entry.chapterId}
            aria-label="Chapter"
            onChange={(e) => {
              const chapterId = e.target.value;
              const without = { ...set, entries: set.entries.filter((x) => x.id !== entry.id) };
              const to = insertionIndex(without, chapterId);
              const from = set.entries.findIndex((x) => x.id === entry.id);
              dispatch({ type: 'moveEntry', id: entry.id, toIndex: to >= from ? to + 1 : to, chapterId });
            }}
          >
            {set.chapters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button className="icon" onClick={() => dispatch({ type: 'removeEntry', id: entry.id })} title="Remove from set">
            ×
          </button>
        </div>
        <div className="entry-detail">
          <input
            className="grow"
            value={entry.transition}
            placeholder={index === 0 ? 'Opening: how do you start?' : 'Transition in: e.g. 32-bar blend, bass swap on the drop, echo out'}
            onChange={(e) => update({ transition: e.target.value })}
          />
          <input className="grow" value={entry.notes} placeholder="Notes / moment" onChange={(e) => update({ notes: e.target.value })} />
          <select value={entry.mixInCueId ?? ''} onChange={(e) => update({ mixInCueId: e.target.value || undefined })} title="Mix-in cue">
            <option value="">Mix in: start</option>
            {cues.map((c) => (
              <option key={c.id} value={c.id}>
                In: {cueLabel(c.id)}
              </option>
            ))}
          </select>
          <select value={entry.mixOutCueId ?? ''} onChange={(e) => update({ mixOutCueId: e.target.value || undefined })} title="Mix-out cue">
            <option value="">Mix out: end</option>
            {cues.map((c) => (
              <option key={c.id} value={c.id}>
                Out: {cueLabel(c.id)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  );
}
