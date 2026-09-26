import { useMemo, useState } from 'react';
import {
  applyTrackMerge,
  describeChange,
  type MergeChoices,
  type MergePlan,
  type MergeStrategy,
  type TrackMergePlan,
} from '../core/merge';
import { SLOT_LETTERS, type Cue } from '../core/model';
import { formatTime } from '../core/time';

const STRATEGIES: { id: MergeStrategy; label: string; help: string }[] = [
  {
    id: 'smart',
    label: 'Smart merge',
    help: 'Combine both. Your edits win, new cues are added, and pad clashes move to free pads.',
  },
  { id: 'keep', label: 'Keep mine', help: 'Leave cues in Setcraft untouched. Only update track info.' },
  { id: 'replace', label: 'Take the file', help: 'Replace cues and beat grid with exactly what the file has.' },
];

export function MergeReview({
  fileName,
  plan,
  onApply,
  onCancel,
}: {
  fileName: string;
  plan: MergePlan;
  onApply: (choices: MergeChoices) => void;
  onCancel: () => void;
}) {
  const [strategy, setStrategy] = useState<MergeStrategy>('smart');
  const [perTrack, setPerTrack] = useState<Record<string, MergeStrategy>>({});
  const [showAll, setShowAll] = useState(false);

  const changed = useMemo(
    () => plan.matches.filter((m) => m.changed).sort((a, b) => Number(b.needsReview) - Number(a.needsReview)),
    [plan.matches],
  );
  const reviewCount = changed.filter((m) => m.needsReview).length;
  const visible = showAll ? changed : changed.slice(0, 25);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="merge-title">
      <div className="modal">
        <header className="modal-head">
          <div>
            <h2 id="merge-title">Merge cues from {fileName}</h2>
            <p className="muted">
              {plan.matches.length} track{plan.matches.length === 1 ? ' is' : 's are'} already in your library
              {plan.newTracks.length ? `, ${plan.newTracks.length} new` : ''}. {changed.length}{' '}
              {changed.length === 1 ? 'has' : 'have'} cue differences
              {reviewCount ? `, ${reviewCount} worth a look` : ''}.
            </p>
          </div>
        </header>

        <div className="strategy-picker" role="radiogroup" aria-label="Default merge strategy">
          {STRATEGIES.map((s) => (
            <button
              key={s.id}
              role="radio"
              aria-checked={strategy === s.id}
              className={`strategy ${strategy === s.id ? 'active' : ''}`}
              onClick={() => {
                setStrategy(s.id);
                setPerTrack({});
              }}
            >
              <span className="strategy-label">
                {s.label}
                {s.id === 'smart' && <span className="badge ok">recommended</span>}
              </span>
              <span className="muted">{s.help}</span>
            </button>
          ))}
        </div>

        <div className="merge-list">
          {visible.map((m) => (
            <TrackMergeRow
              key={m.incoming.id}
              plan={m}
              strategy={perTrack[m.incoming.id] ?? strategy}
              overridden={perTrack[m.incoming.id] !== undefined}
              onChange={(s) => setPerTrack((p) => ({ ...p, [m.incoming.id]: s }))}
            />
          ))}
          {changed.length > visible.length && (
            <button className="link pad" onClick={() => setShowAll(true)}>
              Show {changed.length - visible.length} more tracks…
            </button>
          )}
        </div>

        <footer className="modal-foot">
          <button onClick={onCancel}>Cancel import</button>
          <button className="primary" onClick={() => onApply({ strategy, perTrack })}>
            Import &amp; merge
          </button>
        </footer>
      </div>
    </div>
  );
}

function TrackMergeRow({
  plan,
  strategy,
  overridden,
  onChange,
}: {
  plan: TrackMergePlan;
  strategy: MergeStrategy;
  overridden: boolean;
  onChange: (s: MergeStrategy) => void;
}) {
  const [open, setOpen] = useState(plan.needsReview);
  const result = useMemo(() => applyTrackMerge(plan, strategy).cues, [plan, strategy]);
  const counts = plan.smart.changes.reduce<Record<string, number>>((acc, c) => {
    acc[c.kind] = (acc[c.kind] ?? 0) + 1;
    return acc;
  }, {});
  const notable = plan.smart.changes.filter(
    (c) => c.kind !== 'kept' && !(c.kind === 'matched' && c.fields.length === 0),
  );

  return (
    <div className={`merge-row ${plan.needsReview ? 'attention' : ''}`}>
      <div className="merge-row-head">
        <button className="link merge-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? '▾' : '▸'} <b>{plan.existing.artist}</b> – {plan.existing.title}
        </button>
        <span className="chips">
          {plan.offsetMs !== 0 && (
            <span className="chip info" title="Timing difference between programs; aligned now and re-applied on export">
              {plan.offsetDetected ? 'offset' : 'learned offset'} {plan.offsetMs > 0 ? '+' : ''}
              {plan.offsetMs} ms
            </span>
          )}
          {counts.added ? <span className="chip ok">+{counts.added} new</span> : null}
          {counts.matched ? <span className="chip">{counts.matched} matched</span> : null}
          {counts.removed ? <span className="chip warn">{counts.removed} removed</span> : null}
          {counts.moved ? <span className="chip warn">{counts.moved} pad moved</span> : null}
          {counts.demoted ? <span className="chip warn">{counts.demoted} → memory</span> : null}
        </span>
        <select
          value={strategy}
          className={overridden ? 'overridden' : ''}
          onChange={(e) => onChange(e.target.value as MergeStrategy)}
          aria-label="Merge strategy for this track"
        >
          {STRATEGIES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      {open && (
        <div className="merge-detail">
          <PadStrip label="In Setcraft" cues={plan.existing.cues} />
          <PadStrip label={`In ${plan.source}`} cues={plan.incoming.cues} />
          <PadStrip label="Result" cues={result} highlight />
          {strategy === 'smart' && notable.length > 0 && (
            <ul className="change-list">
              {notable.map((c, i) => (
                <li key={i} className={`change-${c.kind}`}>
                  {describeChange(c)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function PadStrip({ label, cues, highlight }: { label: string; cues: Cue[]; highlight?: boolean }) {
  const pads = SLOT_LETTERS.map((_, i) => cues.find((c) => c.slot === i));
  const memory = cues.filter((c) => c.slot === null);
  return (
    <div className={`pad-strip ${highlight ? 'result' : ''}`}>
      <span className="pad-strip-label">{label}</span>
      {pads.map((c, i) => (
        <span
          key={i}
          className={`mini-pad ${c ? 'filled' : ''}`}
          style={c ? { background: c.color } : undefined}
          title={c ? `${SLOT_LETTERS[i]} ${formatTime(c.start)} ${c.name}${c.edited ? ' (edited in Setcraft)' : ''}` : 'empty'}
        >
          <b>{SLOT_LETTERS[i]}</b>
          {c && <span>{formatTime(c.start, false)}</span>}
          {c?.edited && <i className="edited-dot" aria-label="edited" />}
        </span>
      ))}
      <span className="mini-mem" title={memory.map((c) => formatTime(c.start)).join(', ')}>
        +{memory.length} mem
      </span>
    </div>
  );
}
