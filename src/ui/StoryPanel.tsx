import { useMemo } from 'react';
import { buildTimeline, totalSeconds } from '../core/setplan';
import { formatTime } from '../core/time';
import { EnergyArc } from './EnergyArc';
import { activeSet, useStore } from './store';

/** The set's story, details and chapters, in a pop-up panel over the workspace. */
export function StoryPanel({ onClose }: { onClose: () => void }) {
  const { project, dispatch } = useStore();
  const set = activeSet(project);
  const timeline = useMemo(() => buildTimeline(set, project.library), [set, project.library]);
  const total = totalSeconds(timeline);
  const overUnder = total / 60 - set.targetMinutes;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="story-title" onClick={onClose}>
      <div className="modal story" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2 id="story-title">Story &amp; chapters</h2>
        </header>
        <div className="modal-body">
      <section className="set-meta">
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
          <label title="Clock time the set starts, so the timeline shows real times">
            Starts at
            <input
              type="time"
              value={set.startClock ?? ''}
              onChange={(e) => dispatch({ type: 'updateSet', patch: { startClock: e.target.value || undefined } })}
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
            className="small"
            onClick={() => dispatch({ type: 'duplicateSet', id: set.id })}
            title="Make an editable copy of this set; the original stays as it is"
          >
            Duplicate set
          </button>
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

      <section>
        <div className="card-head">
          <h3>Energy arc</h3>
          <span className="muted">Planned energy per track across the night, coloured by chapter</span>
        </div>
        <EnergyArc set={set} timeline={timeline} />
      </section>

      <section>
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
        </div>
        <footer className="modal-foot">
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
