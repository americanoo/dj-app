import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isDemoTrack } from './demo';
import { keyColor, toCamelot } from '../core/keys';
import { TRACK_DRAG_TYPE } from './Timeline';
import type { Track } from '../core/model';
import { formatTime } from '../core/time';
import { activeSet, useStore } from './store';
import { useAudio } from './audio';
import { LinkFolderButton, MusicFolderPanel } from './MusicFolderControl';
import { useOddBpmIds } from './BpmFixPanel';
import { useFitZoom } from './fit';

type SortKey = 'order' | 'artist' | 'title' | 'bpm' | 'key' | 'duration';

/** Fixed row height (px, matches the CSS) so only the rows in view are rendered. */
const ROW_H = 32;
const OVERSCAN = 12;

export function LibraryView({
  selectedTrackId,
  onSelectTrack,
  onImport,
  onDemo,
  demoBusy = false,
  onFixBpms,
}: {
  selectedTrackId: string | null;
  onSelectTrack: (id: string) => void;
  onImport: () => void;
  /** Add the demo tracks (to try things before importing). */
  onDemo?: () => void;
  demoBusy?: boolean;
  onFixBpms: () => void;
}) {
  const { project, dispatch } = useStore();
  const { audio, rememberedIds, outdatedIds, forgetAll } = useAudio();
  const { library } = project;
  const set = activeSet(project);
  const [playlistId, setPlaylistId] = useState<string | 'all'>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('order');
  const [chapterId, setChapterId] = useState(set.chapters[0]?.id ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const oddIds = useOddBpmIds();
  // The sidebar always fits: the playlist list gives way first, then it scales down.
  const sidebarFit = useFitZoom<HTMLDivElement>(0.5, Object.keys(library.tracks).length > 0);
  const oddBpms = oddIds.size;
  const inSet = useMemo(() => new Set(set.entries.map((e) => e.trackId)), [set.entries]);
  const playlist = library.playlists.find((p) => p.id === playlistId);

  const rows = useMemo(() => {
    const base: Track[] = playlist
      ? playlist.trackIds.map((id) => library.tracks[id]).filter(Boolean)
      : Object.values(library.tracks);
    const q = query.trim().toLowerCase();
    const filtered = q
      ? base.filter((t) =>
          [t.artist, t.title, t.genre, t.label, t.key, toCamelot(t.key), t.bpm?.toFixed(0)]
            .filter(Boolean)
            .some((v) => v!.toLowerCase().includes(q)),
        )
      : base;
    if (sort === 'order') return filtered;
    const val = (t: Track): string | number =>
      sort === 'key' ? (toCamelot(t.key) ?? '').padStart(3, '0') : ((t[sort] as string | number | undefined) ?? '');
    return [...filtered].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    });
  }, [library.tracks, playlist, query, sort]);

  const validChapterId = set.chapters.some((c) => c.id === chapterId) ? chapterId : set.chapters[0]?.id;

  const add = (ids: string[]) => {
    dispatch({ type: 'addEntries', trackIds: ids, chapterId: validChapterId });
    setSelected(new Set());
  };
  // Stable callbacks so unchanged rows skip re-rendering when one track is edited.
  const addRef = useRef(add);
  addRef.current = add;
  const addOne = useCallback((id: string) => addRef.current([id]), []);
  const toggleOne = useCallback(
    (id: string) =>
      setSelected((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }),
    [],
  );

  // Virtual scrolling: a 10k-track collection renders only the ~30 rows on
  // screen, so editing a cue doesn't make React walk thousands of rows.
  const hasTracks = Object.keys(library.tracks).length > 0;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setViewH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasTracks]);
  // Back to the top when the list itself changes (search, playlist, sort).
  useEffect(() => {
    if (wrapRef.current) wrapRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [playlistId, query, sort]);
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);

  if (!hasTracks) {
    return (
      <div className="empty-state">
        <h2>Start with your music</h2>
        <p>
          Import a collection or playlist export from your DJ software. Everything stays in your browser; no files
          are uploaded.
        </p>
        <ul className="howto">
          <li>
            <b>rekordbox</b>: File → Export Collection in xml format
          </li>
          <li>
            <b>Traktor Pro</b>: your <code>collection.nml</code> (Documents/Native Instruments/Traktor x.x) or a playlist
            exported as NML
          </li>
          <li>
            <b>Serato DJ</b>: crate files from <code>Music/_Serato_/Subcrates</code>, or a History export as CSV
          </li>
          <li>
            <b>djay Pro</b>: playlists exported as M3U / CSV, or your rekordbox XML if you use it as djay's library
          </li>
          <li>
            <b>Anything else</b>: M3U8 playlists, CSV spreadsheets, or a plain text tracklist (<code>Artist - Title</code>{' '}
            per line)
          </li>
        </ul>
        <div className="row">
          <button className="primary big" onClick={onImport}>
            Choose files…
          </button>
          <button className="big" onClick={onDemo} disabled={demoBusy} title="Three short tracks made right here in your browser, to try everything out">
            {demoBusy ? 'Making the demo tracks…' : 'Try it with demo tracks'}
          </button>
        </div>
        <p className="muted">…or drag &amp; drop your exports anywhere on this page.</p>
        <div className="empty-folder">
          <p>
            <b>For waveforms</b>, link the folder your music lives in. Subfolders are searched too, and each track's
            audio is found automatically.
          </p>
          <LinkFolderButton />
        </div>
      </div>
    );
  }

  return (
    <div className="library">
      <aside className="sidebar">
        <div className="sidebar-fit" ref={sidebarFit}>
        <h3>Sources</h3>
        <div className="sources-list">
        <button className={playlistId === 'all' ? 'side-item active' : 'side-item'} onClick={() => setPlaylistId('all')}>
          All tracks <span className="count">{Object.keys(library.tracks).length}</span>
        </button>
        {library.playlists.map((p) => (
          <button
            key={p.id}
            className={playlistId === p.id ? 'side-item active' : 'side-item'}
            onClick={() => setPlaylistId(p.id)}
            title={`${p.name} (${p.source})`}
          >
            <span className={`src-dot src-${p.source}`} />
            {p.name} <span className="count">{p.trackIds.length}</span>
          </button>
        ))}
        </div>
        <MusicFolderPanel />
        <div className="sidebar-footer">
          <button
            className="danger small"
            onClick={() => {
              if (!confirm('Remove all tracks, playlists and set entries?')) return;
              dispatch({ type: 'clearLibrary' });
              forgetAll();
            }}
          >
            Clear library
          </button>
        </div>
        </div>
      </aside>

      <section className="library-main">
        <div className="toolbar">
          <input
            type="search"
            placeholder="Search artist, title, genre, key (8A), BPM…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="inline">
            Add to
            <select value={validChapterId} onChange={(e) => setChapterId(e.target.value)}>
              {set.chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <button disabled={!selected.size} onClick={() => add([...selected])}>
            Add {selected.size || ''} selected
          </button>
          {playlist && (
            <button onClick={() => add(playlist.trackIds.filter((id) => library.tracks[id]))}>Add whole playlist</button>
          )}
          <button
            className={oddBpms ? 'fix-bpms has' : 'fix-bpms'}
            onClick={onFixBpms}
            title="Find and fix BPMs read at half or double speed (62 → 124, 192 → 96)"
          >
            Fix BPMs{oddBpms > 0 && <span className="count-pill">{oddBpms}</span>}
          </button>
        </div>

        <div className="table-wrap" ref={wrapRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
          <table className="tracks">
            <thead>
              <tr>
                <th className="check">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={rows.length > 0 && rows.every((r) => selected.has(r.id))}
                    onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                  />
                </th>
                {(
                  [
                    ['artist', 'Artist'],
                    ['title', 'Title'],
                    ['bpm', 'BPM'],
                    ['key', 'Key'],
                    ['duration', 'Time'],
                  ] as [SortKey, string][]
                ).map(([k, label]) => (
                  <th key={k} className={sort === k ? 'sorted' : ''} onClick={() => setSort(sort === k ? 'order' : k)}>
                    {label}
                  </th>
                ))}
                <th>Cues</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {first > 0 && <tr className="spacer" style={{ height: first * ROW_H }} aria-hidden />}
              {rows.slice(first, last).map((t) => (
                <TrackRow
                  key={t.id}
                  track={t}
                  selected={selected.has(t.id)}
                  loaded={t.id === selectedTrackId}
                  inSet={inSet.has(t.id)}
                  oddBpm={oddIds.has(t.id)}
                  wave={audio[t.id] ? 'ok' : rememberedIds.has(t.id) ? (outdatedIds.has(t.id) ? 'outdated' : 'ok') : 'none'}
                  onSelect={onSelectTrack}
                  onAdd={addOne}
                  onToggle={toggleOne}
                />
              ))}
              {last < rows.length && (
                <tr className="spacer" style={{ height: (rows.length - last) * ROW_H }} aria-hidden />
              )}
            </tbody>
          </table>
          {!rows.length && <p className="muted pad">No tracks match.</p>}
        </div>
      </section>
    </div>
  );
}

const TrackRow = memo(function TrackRow({
  track: t,
  selected,
  loaded,
  inSet,
  oddBpm,
  wave,
  onSelect,
  onAdd,
  onToggle,
}: {
  track: Track;
  selected: boolean;
  loaded: boolean;
  inSet: boolean;
  oddBpm: boolean;
  wave: 'none' | 'ok' | 'outdated';
  onSelect: (id: string) => void;
  onAdd: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  return (
    <tr
      className={`${selected ? 'selected' : ''} ${loaded ? 'loaded' : ''}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button, input')) return;
        onSelect(t.id);
      }}
      onDoubleClick={() => onAdd(t.id)}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData(TRACK_DRAG_TYPE, t.id);
        e.dataTransfer.setData('text/plain', `${t.artist} - ${t.title}`);
      }}
      title="Click to load in the deck · drag onto the timeline · double-click to add at the end of the night"
    >
      <td className="check">
        <input type="checkbox" checked={selected} onChange={() => onToggle(t.id)} aria-label="Select" />
      </td>
      <td>{t.artist}</td>
      <td>
        {t.title}
        {isDemoTrack(t) ? (
          <span className="badge" title="A demo track, made by Setcraft for trying things out. Delete it any time.">
            demo
          </span>
        ) : (
          !t.path && (
            <span className="badge warn" title="No file location: can't be exported to DJ software">
              no file
            </span>
          )
        )}
      </td>
      <td className={oddBpm ? 'num bpm-odd' : 'num'} title={oddBpm ? 'Looks like half or double speed: see Fix BPMs' : undefined}>
        {t.bpm ? t.bpm.toFixed(1) : ''}
      </td>
      <td>
        {t.key && (
          <span className="key-pill" style={{ background: keyColor(t.key) }} title={t.key}>
            {toCamelot(t.key) ?? t.key}
          </span>
        )}
      </td>
      <td className="num">{formatTime(t.duration, false)}</td>
      <td className="num">
        <button className="link" onClick={() => onSelect(t.id)}>
          {t.cues.filter((c) => c.slot !== null).length} hot / {t.cues.filter((c) => c.slot === null).length} mem
        </button>
        {wave !== 'none' && (
          <span
            className={`wave-badge ${wave === 'outdated' ? 'outdated' : ''}`}
            title={
              wave === 'outdated'
                ? 'Single-colour waveform from an earlier version; loads in colour when the audio is analysed again'
                : 'Colour waveform ready'
            }
          >
            〰
          </span>
        )}
      </td>
      <td className="actions">
        {inSet ? (
          <span className="badge ok">in set</span>
        ) : (
          <button className="small" onClick={() => onAdd(t.id)}>
            + Set
          </button>
        )}
      </td>
    </tr>
  );
});
