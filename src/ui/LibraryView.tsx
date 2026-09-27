import { useMemo, useState } from 'react';
import { keyColor, toCamelot } from '../core/keys';
import { TRACK_DRAG_TYPE } from './Timeline';
import type { Track } from '../core/model';
import { formatTime } from '../core/time';
import { activeSet, useStore } from './store';
import { useAudio } from './audio';
import { LinkFolderButton, MusicFolderPanel } from './MusicFolderControl';

type SortKey = 'order' | 'artist' | 'title' | 'bpm' | 'key' | 'duration';

export function LibraryView({
  selectedTrackId,
  onSelectTrack,
  onImport,
}: {
  selectedTrackId: string | null;
  onSelectTrack: (id: string) => void;
  onImport: () => void;
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

  if (!Object.keys(library.tracks).length) {
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
        <button className="primary big" onClick={onImport}>
          Choose files…
        </button>
        <p className="muted">…or drag &amp; drop them anywhere on this page.</p>
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

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="library">
      <aside className="sidebar">
        <h3>Sources</h3>
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
        </div>

        <div className="table-wrap">
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
              {rows.slice(0, 2000).map((t) => (
                <tr
                  key={t.id}
                  className={`${selected.has(t.id) ? 'selected' : ''} ${t.id === selectedTrackId ? 'loaded' : ''}`}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('button, input')) return;
                    onSelectTrack(t.id);
                  }}
                  onDoubleClick={() => add([t.id])}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData(TRACK_DRAG_TYPE, t.id);
                    e.dataTransfer.setData('text/plain', `${t.artist} - ${t.title}`);
                  }}
                  title="Click to load in the deck · drag onto the timeline · double-click to add at the end of the night"
                >
                  <td className="check">
                    <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} aria-label="Select" />
                  </td>
                  <td>{t.artist}</td>
                  <td>
                    {t.title}
                    {!t.path && (
                      <span className="badge warn" title="No file location: can't be exported to DJ software">
                        no file
                      </span>
                    )}
                  </td>
                  <td className="num">{t.bpm ? t.bpm.toFixed(1) : ''}</td>
                  <td>
                    {t.key && (
                      <span className="key-pill" style={{ background: keyColor(t.key) }} title={t.key}>
                        {toCamelot(t.key) ?? t.key}
                      </span>
                    )}
                  </td>
                  <td className="num">{formatTime(t.duration, false)}</td>
                  <td className="num">
                    <button className="link" onClick={() => onSelectTrack(t.id)}>
                      {t.cues.filter((c) => c.slot !== null).length} hot / {t.cues.filter((c) => c.slot === null).length} mem
                    </button>
                    {(audio[t.id] || rememberedIds.has(t.id)) && (
                      <span
                        className={`wave-badge ${!audio[t.id] && outdatedIds.has(t.id) ? 'outdated' : ''}`}
                        title={
                          !audio[t.id] && outdatedIds.has(t.id)
                            ? 'Single-colour waveform from an earlier version; loads in colour when the audio is analysed again'
                            : 'Colour waveform ready'
                        }
                      >
                        〰
                      </span>
                    )}
                  </td>
                  <td className="actions">
                    {inSet.has(t.id) ? (
                      <span className="badge ok">in set</span>
                    ) : (
                      <button className="small" onClick={() => add([t.id])}>
                        + Set
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 2000 && <p className="muted pad">Showing 2,000 of {rows.length}. Search to narrow down.</p>}
          {!rows.length && <p className="muted pad">No tracks match.</p>}
        </div>
      </section>
    </div>
  );
}
