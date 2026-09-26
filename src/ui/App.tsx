import { useCallback, useEffect, useRef, useState } from 'react';
import { importFile } from '../core/formats';
import { uid, type Project } from '../core/model';
import { fileName, guessFromFileName } from '../core/xml';
import { AUDIO_EXTENSIONS, useAudio } from './audio';
import { CueEditor } from './CueEditor';
import { ExportPanel } from './ExportPanel';
import { LibraryView } from './LibraryView';
import { NarrativeView } from './NarrativeView';
import { activeSet, useStore } from './store';

export type Tab = 'library' | 'narrative' | 'cues' | 'export';

interface Toast {
  id: string;
  text: string;
  kind: 'info' | 'error';
}

export function App() {
  const { project, dispatch } = useStore();
  const { attach } = useAudio();
  const [tab, setTab] = useState<Tab>('library');
  const [cueTrackId, setCueTrackId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const projectRef = useRef(project);
  projectRef.current = project;

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = uid('toast');
    setToasts((t) => [...t, { id, text, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 9000 : 5000);
  }, []);

  const openCues = useCallback((trackId: string) => {
    setCueTrackId(trackId);
    setTab('cues');
  }, []);

  const handleFiles = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        try {
          if (AUDIO_EXTENSIONS.test(file.name)) {
            await attachAudio(file);
            continue;
          }
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (/\.json$/i.test(file.name)) {
            const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Project;
            if (parsed?.version !== 1 || !parsed.library) throw new Error('Not a Setcraft project file');
            if (confirm('Replace the current project with this backup?')) {
              dispatch({ type: 'load', project: parsed });
              toast(`Restored project "${file.name}"`);
            }
            continue;
          }
          const result = importFile(file.name, bytes);
          dispatch({ type: 'import', result });
          const cues = result.tracks.reduce((n, t) => n + t.cues.length, 0);
          toast(
            `Imported ${result.tracks.length} tracks, ${cues} cues and ${result.playlists.length} playlists from ${file.name} (${result.format}).`,
          );
          for (const w of result.warnings.slice(0, 3)) toast(w, 'info');
          if (result.warnings.length > 3) toast(`…and ${result.warnings.length - 3} more warnings`);
        } catch (e) {
          toast(`${file.name}: ${(e as Error).message}`, 'error');
        }
      }

      async function attachAudio(file: File) {
        const lib = projectRef.current.library;
        const lower = file.name.toLowerCase();
        let match = Object.values(lib.tracks).find((t) => fileName(t.path).toLowerCase() === lower);
        if (!match) {
          const { artist, title } = guessFromFileName(file.name);
          match = { id: uid('trk'), title, artist, cues: [], source: 'manual' };
          dispatch({ type: 'addTrack', track: match });
          toast(`Added "${file.name}" as a new track. Set its file location in the cue editor before exporting.`);
        }
        const info = await attach(match.id, file);
        if (!lib.tracks[match.id]?.duration) {
          dispatch({ type: 'updateTrack', id: match.id, patch: { duration: info.duration } });
        }
        if (files.length === 1) openCues(match.id);
        else toast(`Linked audio for ${match.artist} – ${match.title}`);
      }
    },
    [attach, dispatch, openCues, toast],
  );

  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      setDragging(false);
      void handleFiles(Array.from(e.dataTransfer.files));
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [handleFiles]);

  const set = activeSet(project);
  const trackCount = Object.keys(project.library.tracks).length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ◐
          </span>
          Setcraft
        </div>
        <nav className="tabs" role="tablist">
          {(
            [
              ['library', `Library (${trackCount})`],
              ['narrative', `Narrative (${set.entries.length})`],
              ['cues', 'Cues & loops'],
              ['export', 'Export'],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          <select
            aria-label="Active set"
            value={set.id}
            onChange={(e) => (e.target.value === '__new' ? dispatch({ type: 'addSet' }) : dispatch({ type: 'selectSet', id: e.target.value }))}
          >
            {project.sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="__new">+ New set…</option>
          </select>
          <button className="primary" onClick={() => fileInput.current?.click()}>
            Import
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            accept=".xml,.nml,.crate,.m3u,.m3u8,.csv,.tsv,.txt,.json,audio/*"
            onChange={(e) => {
              void handleFiles(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
        </div>
      </header>

      <main className="content">
        {tab === 'library' && <LibraryView onOpenCues={openCues} onImport={() => fileInput.current?.click()} />}
        {tab === 'narrative' && <NarrativeView onOpenCues={openCues} onGoLibrary={() => setTab('library')} />}
        {tab === 'cues' && <CueEditor trackId={cueTrackId} onSelectTrack={setCueTrackId} />}
        {tab === 'export' && <ExportPanel toast={toast} />}
      </main>

      {dragging && (
        <div className="dropzone">
          <div>
            Drop rekordbox XML, Traktor NML, Serato crates, M3U, CSV or audio files
          </div>
        </div>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
