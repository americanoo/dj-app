# Setcraft (dj-app)

**Plan the story of a DJ set, then set up your hot cues and loops for it and send the plan to the DJ software you play with.**

Setcraft reads the libraries and playlists you already have in **rekordbox, Traktor Pro, Serato DJ and djay Pro**.
You lay the set out as a set of chapters with an energy arc, place hot cues and loops on a waveform, and export
everything back to your DJ software.

Everything runs locally in the browser. Your library and audio files are never uploaded anywhere.

```
npm install
npm run dev      # http://localhost:5173
npm test         # format converters, key maths, set planning
npm run build    # static site in dist/ – host anywhere
```

---

## One-page workspace

Everything happens on one page, in three stacked panels. Drag the handles between them to resize; the sizes
are remembered.

| Panel | What it's for |
|-------|---------------|
| **Deck** (top) | The loaded track: a full-width colour waveform with its sections, and underneath it the eight hot cue pads in one row, the loop and memory cue buttons, and the cue list on the right. ‹ › steps through the night. |
| **Journey of the night** (centre) | A zoomable timeline of the set, from the whole night down to seconds, shown in clock time once the set has a start time. Drag tracks here from the library at the exact moment they should start, and drag them along to move them. Tracks snap to whole seconds and to neighbouring tracks' edges; hold **Shift** for free placement. Alternating lanes show overlaps as blends. Chapter bands and the energy line sit above, and the dot on each track shows its key compatibility with the previous one. Click a track to load it into the deck and edit its start time, chapter, energy, transition, notes and mix points; **Delete** removes it. |
| **Library** (bottom) | Your imported collection and playlists. Click a row to load it into the deck, drag it onto the timeline, or double-click to add it at the end of the night. |

The top bar holds **Story & chapters** (story, venue, start time, target length, chapters and the energy arc),
the music folder, **Versions**, **Export** and **Import**. Keys are colour-coded on the Camelot wheel everywhere:
neighbouring (compatible) keys get neighbouring colours, and minor keys are deeper than major ones.

## The workflow

1. **Import**: drop in your library exports (or click *Import*).
2. **Narrative**: write the story, shape chapters, order tracks and set how much energy each one should have.
3. **Cues & loops**: attach the audio file if you want a waveform, then place hot cues A–H, memory cues and loops.
4. **Export**: download a file for your DJ software, plus a run sheet to keep with you at the gig.

### 1. Import

| Software      | What to export from it                                               | What Setcraft gets                          |
|---------------|----------------------------------------------------------------------|---------------------------------------------|
| rekordbox     | *File → Export Collection in xml format*                             | tracks, playlists (with folders), hot cues, memory cues, loops, cue colours, beat grid |
| Traktor Pro   | `collection.nml`, or a playlist exported as `.nml`                   | tracks, playlists, hot cues, stored cues, loops, beat grid |
| Serato DJ     | `.crate` files from `_Serato_/Subcrates`, or a History export as CSV | track order (crate) and title/artist/BPM/key (CSV) |
| djay Pro      | Playlists as M3U/CSV, or the rekordbox XML if djay uses your rekordbox library | track order and metadata          |
| Anything else | M3U/M3U8, CSV/TSV, or a plain-text tracklist (`01. Artist - Title [Label]`) | track order and metadata             |

Import from several programs and Setcraft combines them into one library. Two tracks count as the same when they
point to the same file path. Their cues are combined with a **smart merge** (below).

#### Waveforms

Your library export only holds file paths, so Setcraft needs the audio to draw waveforms. There are three ways to
give it:

- **Link your music folder** with **♫ Link music folder** in the top bar (also on the start screen, in the
  Library sidebar and in the cue editor). Setcraft
  finds each track's file by name, using parent folders to tell apart files with the same name. Waveforms then load
  automatically when you open a track. Every subfolder is searched, at any depth. The only folders skipped are
  hidden ones and `_Serato_` / `PIONEER`, which hold DJ-software databases rather than music. *Analyse N missing* prepares every track in the current set in one go.
  - In **Chrome/Edge** the folder is remembered. On later visits, one click on *Reconnect* is enough.
  - In **Safari/Firefox** the link lasts for the current visit.
  - The folder doesn't need to be at the same path as in your DJ software (e.g. a USB copy works), as long as
    file names match.
- **Drop audio files** on the page. They're linked to tracks by file name. A file that matches no track is added
  as a new track.
- **Attach audio file…** in the cue editor, for one track.

Waveforms are **remembered**. After the first analysis, each waveform's shape (about 50 KB per track, never the
audio itself) is kept in the browser, so it appears immediately on later visits. Playing the track still needs the
audio. Tracks with a waveform show a 〰 in the library. *Clear library* also forgets the waveforms.
Single-colour waveforms saved by earlier versions show a grey 〰. They're upgraded to colour when the audio loads
again, and *Analyse N tracks* includes them.

#### Smart cue merging

When a track you already have is imported again, from the same program or a different one, its cues are merged
rather than overwritten:

- **Timing offsets are detected.** Different programs can decode the same MP3 a few milliseconds apart. Setcraft
  finds the constant shift from cue pairs and beat grids, lines the cues up, and remembers the offset per track and
  program. Exports to that program re-apply it automatically (you can turn this off in Export → Advanced).
- **The same cue is recognised.** Cues of the same kind within 50 ms are treated as one, matched one-to-one
  (hot cue to hot cue, memory to memory).
- **Your edits win.** Every cue remembers where it came from. A cue you created or changed in Setcraft is never
  overwritten or removed by an import.
- **Newer wins from the same program.** Re-importing from the program a cue came from updates its position, name,
  pad and colour. A *different* program only fills gaps, such as a missing name, an empty pad, or real colours in
  place of Traktor's fixed ones.
- **Nothing is deleted without asking.** A cue may have come from rekordbox or Traktor but no longer be in the
  re-imported file. It's kept and listed in the review under *no longer in rekordbox*, and it's removed only if you
  tick it. If you leave it, it's pinned and won't be flagged again.
- **Pad clashes don't lose cues.** When two cues want the same pad, your edits keep it first, then cues already
  in the library, then new ones. The other cue moves to a free pad, or becomes a memory cue if all eight are
  taken.

If an import would move or re-time anything, or a cue is no longer in the file, a **review screen** shows each
affected track:

- the pads as they are in Setcraft, in the file, and after the merge;
- a list of every change.

Choose *Smart merge*, *Keep mine* or *Take the file*, for the whole import or per track. Imports that only add
cues go straight through. Re-importing the same file changes nothing.

### Copies & versions

- **Duplicate a set.** Use *Duplicate set* in the Narrative tab, or *⧉ Duplicate* in the set picker. The copy is a
  separate set you can reorder and re-plan, and the original stays as it was.
- **Save versions.** Open *Versions* in the top bar, or press **⌘/Ctrl+S** anywhere. A version is a named snapshot
  of the whole project: library, cues and sets.
- **Use an old version** in one of three ways:
  - **Restore all** returns to it completely.
  - **Copy a set out** adds a set from that version as a new set, without changing anything else. It also brings
    back any tracks the set needs that have since left your library.
  - **Earlier versions of these cues**, at the bottom of the cue editor, lists the distinct earlier states of one
    track's cues. Each one shows what's different from now, pad by pad, and can be restored on its own.
    Restored cues count as your edits, so imports won't overwrite them.
- **Automatic safety net.** A version is saved before every import that changes tracks already in your library,
  and before every restore, so each restore can be undone. The newest 20 automatic versions are kept. Versions
  you save or rename yourself are kept until you delete them.
- Versions live in this browser (IndexedDB). Use *Export → Back up whole project* to move a project to another
  computer.

### 2. Narrative: planning the set's story

- **The story**: a free-text brief of where you want to take the room.
- **Chapters**: the default four are *Warm-up → Build → Peak → Cool-down*. You can rename, recolour, reorder, add
  or remove them, and give each one an intent ("what should the crowd feel here?").
- **Running order**: drag tracks between and within chapters. Each track has:
  - an **energy** value from 1 to 10;
  - **transition** and **notes** fields;
  - **mix-in / mix-out cues**, which set how long the track actually plays.
- **Energy arc**: a live chart of planned energy across the set, with chapter bands and a marker for your target
  length.
- **Transition checks**: each change between tracks shows its harmonic relation on the Camelot wheel (same key,
  ±1, relative, diagonal, energy boost). Key clashes and BPM jumps over 6% are flagged, both in the list and on
  the arc.

### 3. Cues & loops

- **Waveforms** in rekordbox-style three-band colour (bass blue, mids amber, highs white), normalised so quiet
  masters still fill the view and smooth at every zoom level. There's a detail view with the beat grid and bar
  numbers, and an overview below it for navigating. Both redraw every frame while playing from an interpolated
  audio clock, and the shape is sampled at fixed points in the track, so it glides without flickering. Analysis runs in a background worker so the page stays responsive.
- **Easy navigation.** Grab the zoomed waveform and pull it like a record (drag left to go forward), or drag along
  the overview. Scroll the wheel/trackpad over the waveform to move through the track, and **⌘/Ctrl + scroll**
  to zoom from 2 to 32 bars. A plain click jumps there. Scrubbing while playing holds the audio like a hand on
  the record and carries on from the new spot when you let go.
- **Song sections** are detected automatically from the colour waveform: Intro, Main, Breakdown, Build, Drop and
  Outro, decided in 8-bar phrases from where the bass drops out and comes back. Each part is tinted and labelled on
  both waveforms, with phrase lines every 16 bars. Section chips under the waveform jump to each part, and
  *+ Memory cues at sections* drops a named memory cue at the start of each one.
- **Audio engine** on the Web Audio API: cue jumps are instant and sample-accurate, with short fades so they don't
  click. Tapping a filled pad plays from it, like a CDJ. **Loop pads really loop**: tap to engage, tap again (or
  *exit*) to release, and jumping outside the loop releases it too. Loops follow you live as you drag or resize
  them. There's also a preview volume control. Without audio
  you still get the timeline, grid and cue markers.
- **Snap: Free / Beat / Bar.** Choose where cues, loops and clicks land: exactly where you put them (*Free*),
  on the nearest beat, or on the nearest bar. `Q` cycles through the three, and the choice is remembered.
- **Pads A–H** behave like a controller: an empty pad sets a cue at the playhead, a filled pad jumps to its cue.
  Pads fire the moment you press them (not on release) and use the exact audio position, so the marker lands
  where you heard it, even with a large library loaded.
- **Loops** from 1 beat to 8 bars, either on a pad or saved as memory loops. **Memory cues** too.
- **Drag cues anywhere.** Grab a marker on either waveform and drop it somewhere else. It follows the snap
  setting (hold **Shift** for free placement), a readout shows the time and bar while you drag, and **Esc** cancels. Drag a
  loop's right edge to resize it.
- **Drag between pads.** Drop a pad onto another pad to move it; if that pad is taken, the two swap. Drop a pad
  on *make it a memory cue*, or drag a memory cue from the list onto a pad.
- Markers can also be moved precisely in the cue form. Each cue can be edited by name, colour, pad, start time (typed or
  nudged by bar, beat or 10 ms), type, and loop length in beats.
- Keyboard: `Space` play/pause · `1`–`8` pads · `M` memory cue · `Q` snap Free/Beat/Bar · `←/→` beat
  (`Shift`: bar) · `[` / `]` previous/next cue · `Delete` removes the selected cue.
- Editing a track's BPM, key, grid start or file location here fixes that track's details before export.
  **×½ / ×2** next to BPM fix half- or double-time readings (e.g. a 96 BPM reggaeton track read as 192)
  without moving the downbeat. On the timeline, half/double-time mixes (96 → 192) aren't flagged as BPM jumps.

### 4. Export

| Target                  | File           | Carries                                 | How to load it |
|-------------------------|----------------|-----------------------------------------|----------------|
| rekordbox               | `.xml`         | playlist, hot cues + colours, memory cues, loops, grid | Preferences → Advanced → *rekordbox xml* → import the playlist from the *rekordbox xml* tree |
| Traktor Pro             | `.nml`         | playlist, hot cues, stored cues, loops, grid | *Import Playlist*, or *Import Another Collection* to merge cues into existing tracks |
| djay Pro                | rekordbox `.xml` | playlist, hot cues, loops              | djay's rekordbox library integration |
| Serato DJ               | `.crate`       | track order                             | copy into `_Serato_/Subcrates` |
| Any software            | `.m3u8`        | track order                             | drag into a playlist |

**Advanced options:**
- *Path prefix rewrite*, for when the music lives somewhere else on the gig laptop or USB drive.
- *macOS volume name* for Traktor.
- *Cue offset in ms*: some MP3s decode with a slightly different start in different programs, so this shifts
  every cue and grid marker by a fixed amount.

**Also exported:**
- A **run sheet** (Markdown or text) with every chapter, track, start time, transition note, hot cue and warning.
- A **project backup** (JSON). Import it to restore everything on another browser or computer.

---

## Architecture

```
src/
  core/                 pure TypeScript, no UI – unit tested
    model.ts            software-neutral Track / Cue / SetPlan / Chapter model
    merge.ts            smart cue merge: offset detection, matching, provenance rules, pad conflicts
    versions.ts         set copies, version pruning, per-track cue history and diffs
    waveform.ts         compact (8-bit) waveform storage
    analysis.ts         three-band waveform analysis (biquad filters)
    sections.ts         intro / breakdown / build / drop / outro detection
    pathmatch.ts        finding a track's file inside a linked music folder
    keys.ts             key parsing (standard, Camelot, Open Key, Traktor ids) + harmonic relations
    time.ts             time formatting, beat/bar snapping, bar.beat labels
    setplan.ts          set timeline, transition warnings, run-sheet generation
    xml.ts              XML + file-URL helpers
    formats/
      rekordbox.ts      rekordbox XML import/export
      traktor.ts        Traktor NML import/export (volume/dir path mapping)
      serato.ts         Serato .crate binary import/export
      text.ts           M3U/M3U8, CSV/TSV (incl. Serato history), plain tracklists
      index.ts          format detection, export targets, cue offset
  ui/                   React
    store.tsx           project state (reducer) persisted to IndexedDB
    audio.tsx           audio attachments, waveform analysis, remembered waveforms (IndexedDB)
    musicFolder.tsx     linked music folder (File System Access API, folder-input fallback)
    deck.ts             Web Audio playback: instant jumps, real loops, click-free fades
    analysisWorker.ts   waveform analysis off the main thread
    versions.tsx        version snapshots stored in IndexedDB
    App (one-page layout), CueEditor (deck), Timeline, LibraryView, StoryPanel, EnergyArc, Waveform,
    ExportPanel, MergeReview, VersionsPanel
```

Each importer converts into a single internal model, and each exporter converts out of it. Cue positions are stored
in seconds and hot cues keep their pad index, so rekordbox, Traktor and djay can all read what you set up.

## Known limitations and roadmap

- **Cue points in Serato.** Serato keeps cues inside the audio files' tags (`Serato Markers2`), not in its crate
  files. Writing those tags means modifying your audio files, so it's the next big item. For now, use Serato's
  rekordbox library import, or re-set the cues from the run sheet.
- **djay Pro's own library** (`MediaLibrary.db`) isn't read directly. Use M3U/CSV, or the rekordbox XML route.
- **Re-importing into rekordbox or Traktor:** tracks already in your collection may keep their existing cues,
  depending on the program. Try it on a test playlist first.
- **Variable-tempo grids** from rekordbox are kept on export. Editing the BPM or grid start in Setcraft replaces
  them with a single fixed grid.
- **Ideas for later:**
  - VirtualDJ and Engine DJ adapters;
  - suggested next tracks for an empty spot in the energy arc;
  - a shared set plan for B2B sets;
  - printable PDF run sheets.
