import { useState, type ReactNode } from 'react';
import { filterActive, SORT_KEYS, type ListFilter, type SortKey } from '../../core/listsort';
import { normaliseKey, parseKey, toCamelot } from '../../core/keys';

export interface ListPrefs {
  sort: SortKey;
  desc: boolean;
  filter: ListFilter;
}

/** Sort and filter choices for one list, remembered on this device. */
export function useListPrefs(name: string, initial: ListPrefs): [ListPrefs, (p: ListPrefs) => void] {
  const key = `setcraft-m-list-${name}`;
  const [prefs, setPrefs] = useState<ListPrefs>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
      // "fits after" points at a track of the moment, so it isn't kept.
      return saved ? { ...initial, ...saved, filter: { ...saved.filter, fitsAfter: undefined } } : initial;
    } catch {
      return initial;
    }
  });
  return [
    prefs,
    (p) => {
      setPrefs(p);
      try {
        localStorage.setItem(key, JSON.stringify(p));
      } catch {
        // private mode
      }
    },
  ];
}

/**
 * The quiet strip along the top edge of a list: what it's sorted by and how
 * many filters are on. Tap either to open the panel.
 */
export function ListTools({
  label,
  prefs,
  onPrefs,
  sortLabel = 'sort',
  sortOptions = SORT_KEYS,
  onSort,
  shown,
  total,
  extra,
  before,
}: {
  label: string;
  prefs: ListPrefs;
  onPrefs: (p: ListPrefs) => void;
  sortLabel?: string;
  sortOptions?: { id: string; label: string }[];
  /** Instead of a sort kept as a view, an action (the night: arrange its order). */
  onSort?: (id: string) => void;
  shown: number;
  total: number;
  /** More filter rows (in the night / fits after). */
  extra?: ReactNode;
  /** Controls at the start of the strip (the night's zoom). */
  before?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const f = prefs.filter;
  const n = filterActive(f);
  const setFilter = (patch: Partial<ListFilter>) => onPrefs({ ...prefs, filter: { ...f, ...patch } });
  const num = (v: string) => {
    const x = Number(v);
    return v.trim() && Number.isFinite(x) && x > 0 ? x : undefined;
  };
  const sortName = SORT_KEYS.find((s) => s.id === prefs.sort)?.label ?? prefs.sort;

  return (
    <div className="m-tools-edge">
      {before}
      {n > 0 && (
        <span className="m-tools-count">
          {shown} of {total}
        </span>
      )}
      <span className="grow" />
      <button className="m-edge-btn" aria-label={`${label}: sort and filter`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {onSort ? sortLabel : `${sortName} ${prefs.desc ? '↓' : '↑'}`}
        <span className="m-edge-sep">·</span>
        filter{n > 0 && <b className="m-edge-dot">{n}</b>}
      </button>
      {open && (
        <>
          <div className="m-scrim" onClick={() => setOpen(false)} />
          <div className="m-popover m-tools-pop" role="dialog" aria-label={`${label}: sort and filter`}>
            <div className="m-tools-sec">
              <span className="m-tools-h">{sortLabel}</span>
              <div className="m-tools-chips">
                {sortOptions.map((s) => (
                  <button
                    key={s.id}
                    className={`m-chip${!onSort && prefs.sort === s.id ? ' on' : ''}`}
                    aria-pressed={!onSort ? prefs.sort === s.id : undefined}
                    onClick={() => {
                      if (onSort) {
                        onSort(s.id);
                        setOpen(false);
                      } else onPrefs({ ...prefs, sort: s.id as SortKey, desc: prefs.sort === s.id ? !prefs.desc : false });
                    }}
                  >
                    {s.label}
                    {!onSort && prefs.sort === s.id ? (prefs.desc ? ' ↓' : ' ↑') : ''}
                  </button>
                ))}
              </div>
            </div>
            <div className="m-tools-sec" key={`${f.bpmMin}-${f.bpmMax}-${f.key}`}>
              <span className="m-tools-h">filter</span>
              <label className="m-tools-row">
                <span>bpm</span>
                <input className="m-tools-in" inputMode="decimal" placeholder="min" aria-label="lowest bpm" defaultValue={f.bpmMin ?? ''} onBlur={(e) => setFilter({ bpmMin: num(e.target.value) })} />
                <span className="m-muted">–</span>
                <input className="m-tools-in" inputMode="decimal" placeholder="max" aria-label="highest bpm" defaultValue={f.bpmMax ?? ''} onBlur={(e) => setFilter({ bpmMax: num(e.target.value) })} />
              </label>
              <label className="m-tools-row">
                <span>key</span>
                <input
                  className="m-tools-in"
                  placeholder="8A"
                  aria-label="filter by key"
                  autoCapitalize="characters"
                  defaultValue={toCamelot(f.key) ?? ''}
                  onBlur={(e) => setFilter({ key: parseKey(e.target.value) ? normaliseKey(e.target.value) : undefined })}
                />
                <button className={`m-chip${f.mixable ? ' on' : ''}`} aria-pressed={!!f.mixable} onClick={() => setFilter({ mixable: !f.mixable })} title="also the keys that mix with it">
                  + mixable
                </button>
              </label>
              {extra}
            </div>
            <div className="m-tools-foot">
              <button className="m-text-btn" disabled={!n} onClick={() => onPrefs({ ...prefs, filter: {} })}>
                clear filters
              </button>
              <button className="m-chip" onClick={() => setOpen(false)}>
                done
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
