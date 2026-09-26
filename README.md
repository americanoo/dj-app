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
point to the same file path. When a newer import carries cues for a track, its cues replace that track's older ones.

Drop **audio files** on the page to link them to tracks by file name. A file that matches no track in your library
is added as a new track.

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

- A detail waveform with the beat grid and bar numbers, and an overview below it for navigating. Without audio
  you still get the timeline, grid and cue markers.
- **Pads A–H** behave like a controller: an empty pad sets a cue at the playhead, a filled pad jumps to its cue.
  **Quantize** snaps cues to the grid.
- **Loops** from 1 beat to 8 bars, either on a pad or saved as memory loops. **Memory cues** too.
- Drag markers on the waveform to move them. Each cue can be edited by name, colour, pad, start time (typed or
  nudged by bar, beat or 10 ms), type, and loop length in beats.
- Keyboard: `Space` play/pause · `1`–`8` pads · `M` memory cue · `Q` quantize · `←/→` beat (`Shift`: bar) ·
  `Delete` removes the selected cue.
- Editing a track's BPM, key, grid start or file location here fixes that track's details before export.

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
    model.ts            software-neutral Track / Cue / SetPlan / Chapter model + library merge
    keys.ts             key parsing (standard, Camelot, Open Key, Traktor ids) + harmonic relations
    time.ts             time formatting, beat grid snapping, bar.beat labels
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
    audio.tsx           session-only audio attachments + waveform peak analysis
    LibraryView, NarrativeView, EnergyArc, CueEditor, Waveform, ExportPanel
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
