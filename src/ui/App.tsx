import { useCallback, useEffect, useRef, useState } from 'react';
import { importFile } from '../core/formats';
import { planMerge, type MergeChoices, type MergePlan } from '../core/merge';
import { uid, type Project } from '../core/model';
import { fileName, guessFromFileName } from '../core/xml';
import { AUDIO_EXTENSIONS, useAudio } from './audio';
import { CueEditor } from './CueEditor';
import { ExportPanel } from './ExportPanel';
import { LibraryView } from './LibraryView';
import { MergeReview } from './MergeReview';
import { LinkFolderButton } from './MusicFolderControl';
import { useVersions } from './versions';
import { defaultVersionName, VersionsPanel } from './VersionsPanel';
import { StoryPanel } from './StoryPanel';
import { Timeline } from './Timeline';
import { activeSet, useStore } from './store';


interface PendingMerge {
  fileName: string;
  plan: MergePlan;
  resolve: (choices: MergeChoices | null) => void;
}

interface Toast {
  id: string;
  text: string;
  kind: 'info' | 'error';
}

export function App() {
  const { project, dispatch } = useStore();
  const { attach } = useAudio();
  const { save: saveVersion } = useVersions();
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [loadedTrackId, setLoadedTrackId] = useState<string | null>(null);
  const [storyOpen, setStoryOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [layout, setLayout] = useState(loadLayout);
  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      // private mode: sizes just aren't remembered
    }
  }, [layout]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dragging, setDragging] = useState(false);
  const [pendingMerge, setPendingMerge] = useState<PendingMerge | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const projectRef = useRef(project);
  projectRef.current = project;

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = uid('toast');
    setToasts((t) => [...t, { id, text, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 9000 : 5000);
  }, []);

  const openCues = useCallback((trackId: string) => setLoadedTrackId(trackId), []);

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
            if (confirm('Replace the current project with this backup? The current state is saved as a version first.')) {
              await saveVersion(projectRef.current, `Before restoring ${file.name}`, true).catch(() => undefined);
              dispatch({ type: 'load', project: parsed });
              toast(`Restored project "${file.name}"`);
            }
            continue;
          }
          const result = importFile(file.name, bytes);
          const plan = planMerge(projectRef.current.library, result);
          const choices = await reviewMerge(file.name, plan);
          if (!choices) {
            toast(`Cancelled import of ${file.name}`);
            continue;
          }
          // Safety net: snapshot before an import changes tracks already in the library.
          if (plan.matches.some((m) => m.changed)) {
            await saveVersion(projectRef.current, `Before importing ${file.name}`, true).catch(() => undefined);
          }
          dispatch({ type: 'import', result, choices });
          // Let the store update before the next file is planned against it.
          await new Promise((r) => setTimeout(r, 0));
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

      /** Ask the DJ to review cue merges when an import changes cues already in the library. */
      function reviewMerge(fileName: string, plan: MergePlan): Promise<MergeChoices | null> {
        if (!plan.matches.some((m) => m.needsReview)) return Promise.resolve({ strategy: 'smart' });
        return new Promise((resolve) => setPendingMerge({ fileName, plan, resolve }));
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
    [attach, dispatch, openCues, toast, saveVersion],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const name = defaultVersionName();
        saveVersion(projectRef.current, name)
          .then(() => toast(`Saved "${name}". Open Versions to rename or restore it.`))
          .catch((err) => toast(`Couldn't save the version: ${(err as Error).message}`, 'error'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveVersion, toast]);

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

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ◐
          </span>
          Setcraft
        </div>
        <div className="topbar-right">
          <select
            aria-label="Active set"
            value={set.id}
            onChange={(e) =>
              e.target.value === '__new'
                ? dispatch({ type: 'addSet' })
                : e.target.value === '__dup'
                  ? dispatch({ type: 'duplicateSet', id: set.id })
                  : dispatch({ type: 'selectSet', id: e.target.value })
            }
          >
            {project.sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="__new">+ New set…</option>
            <option value="__dup">⧉ Duplicate "{set.name}"</option>
          </select>
          <button onClick={() => setStoryOpen(true)} title="Story, venue, start time and chapters of this set">
            Story &amp; chapters
          </button>
          <LinkFolderButton topbar />
          <button onClick={() => setVersionsOpen(true)} title="Save and restore versions (⌘/Ctrl+S saves one)">
            Versions
          </button>
          <button onClick={() => setExportOpen(true)} title="Export to rekordbox, Traktor, Serato, djay Pro or M3U8">
            Export
          </button>
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

      <main className="workspace-layout">
        <section className="pane deck-pane" style={{ height: layout.deck }}>
          <CueEditor trackId={loadedTrackId} onSelectTrack={setLoadedTrackId} />
        </section>
        <Splitter onDrag={(dy) => setLayout((l) => ({ ...l, deck: clamp(l.deck + dy, 170, 900) }))} />
        <section className="pane timeline-host" style={{ height: layout.timeline }}>
          <Timeline selectedTrackId={loadedTrackId} onSelectTrack={setLoadedTrackId} onOpenStory={() => setStoryOpen(true)} />
        </section>
        <Splitter onDrag={(dy) => setLayout((l) => ({ ...l, timeline: clamp(l.timeline + dy, 150, 700) }))} />
        <section className="pane library-pane">
          <LibraryView
            selectedTrackId={loadedTrackId}
            onSelectTrack={setLoadedTrackId}
            onImport={() => fileInput.current?.click()}
          />
        </section>
      </main>

      {versionsOpen && <VersionsPanel onClose={() => setVersionsOpen(false)} toast={toast} />}
      {storyOpen && <StoryPanel onClose={() => setStoryOpen(false)} />}
      {exportOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Export" onClick={() => setExportOpen(false)}>
          <div className="modal export-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-body">
              <ExportPanel toast={toast} />
            </div>
            <footer className="modal-foot">
              <button onClick={() => setExportOpen(false)}>Close</button>
            </footer>
          </div>
        </div>
      )}
      {pendingMerge && (
        <MergeReview
          fileName={pendingMerge.fileName}
          plan={pendingMerge.plan}
          onApply={(choices) => {
            pendingMerge.resolve(choices);
            setPendingMerge(null);
          }}
          onCancel={() => {
            pendingMerge.resolve(null);
            setPendingMerge(null);
          }}
        />
      )}
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

const LAYOUT_KEY = 'setcraft-layout-v1';

/** Heights (px) of the deck and timeline panes; the library gets the rest. */
function loadLayout(): { deck: number; timeline: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null');
    if (saved && typeof saved.deck === 'number' && typeof saved.timeline === 'number') return saved;
  } catch {
    // fall through to defaults
  }
  return { deck: 380, timeline: 250 };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Drag handle between two stacked panes. */
function Splitter({ onDrag }: { onDrag: (dy: number) => void }) {
  const last = useRef<number | null>(null);
  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="horizontal"
      title="Drag to resize"
      onPointerDown={(e) => {
        last.current = e.clientY;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (last.current === null) return;
        onDrag(e.clientY - last.current);
        last.current = e.clientY;
      }}
      onPointerUp={() => {
        last.current = null;
      }}
    />
  );
}
