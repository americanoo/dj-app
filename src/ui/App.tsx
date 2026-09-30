import { useCallback, useEffect, useRef, useState } from 'react';
import { importFile } from '../core/formats';
import { planMerge, type MergeChoices, type MergePlan } from '../core/merge';
import { uid, type Project } from '../core/model';
import { fileName, guessFromFileName } from '../core/xml';
import { AUDIO_EXTENSIONS, useAudio } from './audio';
import { findTempoFixes } from '../core/tempo';
import { BpmFixPanel, loadTempoRange } from './BpmFixPanel';
import { CueEditor } from './CueEditor';
import { FoundingPanel } from './FoundingPanel';
import { ControllerPanel } from './ControllerPanel';
import { useMidi } from './midi';
import { useLicense } from './license';
import { ExportPanel } from './ExportPanel';
import { LibraryView } from './LibraryView';
import { MergeReview } from './MergeReview';
import { LinkFolderButton } from './MusicFolderControl';
import { useVersions } from './versions';
import { defaultVersionName, VersionsPanel } from './VersionsPanel';
import { StoryPanel } from './StoryPanel';
import { Timeline } from './Timeline';
import { activeSet, reducer, useStore } from './store';


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
  const { project, dispatch, undoLabel, redoLabel } = useStore();
  const { attach } = useAudio();
  const { save: saveVersion } = useVersions();
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [foundingOpen, setFoundingOpen] = useState(false);
  const [controllerOpen, setControllerOpen] = useState(false);
  const midi = useMidi();
  const { founding } = useLicense();
  const [loadedTrackId, setLoadedTrackId] = useState<string | null>(null);
  const [storyOpen, setStoryOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [bpmFixOpen, setBpmFixOpen] = useState(false);
  const [layout, setLayout] = useState(loadLayout);
  // The library always keeps a usable height: on a short window (or with the player bar
  // taking room) the deck and timeline give way proportionally. Saved sizes are kept.
  const mainRef = useRef<HTMLElement>(null);
  const [room, setRoom] = useState(0);
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      setRoom(el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 20); // two splitters
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const LIBRARY_MIN = 200;
  const squeeze = room > 0 && layout.deck + layout.timeline > room - LIBRARY_MIN ? Math.max(0.3, (room - LIBRARY_MIN) / (layout.deck + layout.timeline)) : 1;
  const deckH = Math.round(layout.deck * squeeze);
  const timelineH = Math.round(layout.timeline * squeeze);
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

  const undoRef = useRef({ undoLabel, redoLabel });
  undoRef.current = { undoLabel, redoLabel };
  const undoOrRedo = useCallback(
    (which: 'undo' | 'redo') => {
      const label = which === 'undo' ? undoRef.current.undoLabel : undoRef.current.redoLabel;
      if (!label) return;
      dispatch({ type: which });
      toast(`${which === 'undo' ? 'Undid' : 'Redid'}: ${label}`);
    },
    [dispatch, toast],
  );

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
          const action = { type: 'import' as const, result, choices };
          // What the library looks like after this merge, for the BPM check below.
          const merged = reducer(projectRef.current, action).library.tracks;
          dispatch(action);
          // Let the store update before the next file is planned against it.
          await new Promise((r) => setTimeout(r, 0));
          const cues = result.tracks.reduce((n, t) => n + t.cues.length, 0);
          toast(
            `Imported ${result.tracks.length} tracks, ${cues} cues and ${result.playlists.length} playlists from ${file.name} (${result.format}).`,
          );
          // Checked after merging, so BPMs already fixed (or kept) here aren't reported again.
          const odd = findTempoFixes(Object.values(merged), loadTempoRange()).length;
          if (odd) toast(`${odd} BPM${odd === 1 ? ' looks' : 's look'} half or double speed. Use “Fix BPMs” in the library to check them.`);
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

  // Esc closes the pop-up panels.
  useEffect(() => {
    if (!storyOpen && !exportOpen && !versionsOpen && !bpmFixOpen && !foundingOpen && !controllerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setStoryOpen(false);
      setExportOpen(false);
      setVersionsOpen(false);
      setBpmFixOpen(false);
      setFoundingOpen(false);
      setControllerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [storyOpen, exportOpen, versionsOpen, bpmFixOpen, foundingOpen, controllerOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && (key === 'z' || key === 'y')) {
        // Typing in a text field keeps the field's own undo.
        const t = e.target as HTMLElement;
        const typing =
          t.isContentEditable ||
          t.tagName === 'TEXTAREA' ||
          (t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button', 'file'].includes((t as HTMLInputElement).type));
        if (typing) return;
        e.preventDefault();
        undoOrRedo(key === 'y' || e.shiftKey ? 'redo' : 'undo');
        return;
      }
      if (mod && key === 's') {
        e.preventDefault();
        const name = defaultVersionName();
        saveVersion(projectRef.current, name)
          .then(() => toast(`Saved "${name}". Open Versions to rename or restore it.`))
          .catch((err) => toast(`Couldn't save the version: ${(err as Error).message}`, 'error'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveVersion, toast, undoOrRedo]);

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
          <div className="undo-redo">
            <button
              className="icon"
              onClick={() => undoOrRedo('undo')}
              disabled={!undoLabel}
              title={undoLabel ? `Undo ${undoLabel} (⌘Z / Ctrl+Z)` : 'Nothing to undo'}
              aria-label="Undo"
            >
              ↶
            </button>
            <button
              className="icon"
              onClick={() => undoOrRedo('redo')}
              disabled={!redoLabel}
              title={redoLabel ? `Redo ${redoLabel} (⇧⌘Z / Ctrl+Y)` : 'Nothing to redo'}
              aria-label="Redo"
            >
              ↷
            </button>
          </div>
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
          <button
            onClick={() => setControllerOpen(true)}
            title={midi.status === 'on' && midi.devices.length ? `Controller: ${midi.devices.join(', ')}` : 'Connect and map a DJ controller'}
          >
            <span className={`status-dot ${midi.status === 'on' && midi.devices.length ? 'ok' : ''}`} /> Controller
          </button>
          <button onClick={() => setVersionsOpen(true)} title="Save and restore versions (⌘/Ctrl+S saves one)">
            Versions
          </button>
          <button onClick={() => setExportOpen(true)} title="Export to rekordbox, Traktor, Serato, djay Pro or M3U8">
            Export
          </button>
          <button
            className={`founding-btn ${founding ? 'is-founder' : ''}`}
            onClick={() => setFoundingOpen(true)}
            title={founding ? `Founding DJ${founding.no ? ` #${founding.no}` : ''}: ${founding.n}` : 'Become a Founding DJ'}
          >
            ★ {founding ? `Founding DJ${founding.no ? ` #${founding.no}` : ''}` : 'Founding DJ'}
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

      <main ref={mainRef} className="workspace-layout">
        <section className="pane deck-pane" style={{ height: deckH }}>
          <CueEditor trackId={loadedTrackId} onSelectTrack={setLoadedTrackId} />
        </section>
        <Splitter value={deckH} min={200} max={900} onChange={(deck) => setLayout({ deck, timeline: timelineH })} />
        <section className="pane timeline-host" style={{ height: timelineH }}>
          <Timeline selectedTrackId={loadedTrackId} onSelectTrack={setLoadedTrackId} onOpenStory={() => setStoryOpen(true)} />
        </section>
        <Splitter value={timelineH} min={150} max={700} onChange={(timeline) => setLayout({ deck: deckH, timeline })} />
        <section className="pane library-pane">
          <LibraryView
            selectedTrackId={loadedTrackId}
            onSelectTrack={setLoadedTrackId}
            onImport={() => fileInput.current?.click()}
            onFixBpms={() => setBpmFixOpen(true)}
          />
        </section>
      </main>

      {bpmFixOpen && <BpmFixPanel onClose={() => setBpmFixOpen(false)} toast={toast} />}
      {controllerOpen && <ControllerPanel onClose={() => setControllerOpen(false)} />}
      {foundingOpen && <FoundingPanel onClose={() => setFoundingOpen(false)} toast={toast} />}
      {versionsOpen && <VersionsPanel onClose={() => setVersionsOpen(false)} toast={toast} />}
      {storyOpen && <StoryPanel onClose={() => setStoryOpen(false)} />}
      {exportOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Export" onClick={() => setExportOpen(false)}>
          <div className="modal export-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-body">
              <ExportPanel
                toast={toast}
                onUpgrade={() => {
                  setExportOpen(false);
                  setFoundingOpen(true);
                }}
              />
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
  return { deck: 440, timeline: 240 };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Drag handle between two stacked panes. */
function Splitter({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  // Sizes follow the pointer's position from where the drag started, so the
  // handle stays under the pointer even after hitting the smallest or largest size.
  const start = useRef<{ y: number; value: number } | null>(null);
  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="horizontal"
      title="Drag to resize"
      onPointerDown={(e) => {
        start.current = { y: e.clientY, value };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (s) onChange(clamp(s.value + e.clientY - s.y, min, max));
      }}
      onPointerUp={() => {
        start.current = null;
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
    />
  );
}
