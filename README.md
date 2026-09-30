# Setcraft (dj-app)

**Plan the story of a DJ set, then set up your hot cues and loops for it and send the plan to the DJ software you play with.**

Setcraft reads the libraries and playlists you already have in **rekordbox, Traktor Pro, Serato DJ and djay Pro**.
You lay the set out as a set of chapters with an energy arc, place hot cues and loops on a waveform, and export
everything back to your DJ software.

Everything runs locally in the browser. Your library and audio files are never uploaded anywhere.

```
npm install
npm start        # fast, optimised build at http://localhost:4173 (use this for real sessions)
npm run dev      # development mode with live reload, http://localhost:5173 (slower)
npm test         # format converters, key maths, set planning, mix plan
npm run e2e      # browser tests: the real app in Chromium with generated test tracks (sound, night, transitions, export)
npm run build    # static site in dist/ – host anywhere
```

---

## First time? The tutorial

The first time you open Setcraft, a short welcome offers a **hands-on tour**. Pick **Try it with demo tracks**
(three short club tracks made right in your browser, so you can learn before your library is ready) or **Use my
own music**. The tour then spotlights one part of the screen at a time: importing and linking your music folder,
the library, the journey of the night, the transition view (blend, Sync, keyframes), the deck and hot cues, the
player, and export. Most steps ask you to do the thing (add two tracks to the set, overlap them, preview the
transition, set a cue, press play) and move on by themselves once you have; a step you've already done is just
read, and **Skip** / **Next** moves on anyway. **Esc** ends it. Replay it any time from **⋯ → Tutorial**. The
demo tracks are also on offer on the empty library screen, and show a *demo* badge in the library.

## One-page workspace

Everything happens on one page, in four stacked panels. Drag the handles between them to resize; the sizes
are remembered. Every panel always shows all of its controls without scrolling: a taller deck gets a taller
waveform and a taller timeline gets taller lanes, and when a panel gets too small for everything at full size,
its contents scale down to fit. Only long lists (library tracks, playlists, a track's cue list) scroll within
their own space. Earlier versions of a track's cues open from **History** in the cue list.

| Panel | What it's for |
|-------|---------------|
| **Transition** (top) | Two decks on one clock: the outgoing track (A) on the left, the incoming one (B) on the right, and both waveforms in between, lined up exactly as the night plays them. Where both play is highlighted (a gap in red), **A OUT** and **B IN** mark the handover, and the parts of each file the night doesn't play are ghosted. Chips show the blend length in bars, the tempo change, whether the keys fit, and where B comes in on A's grid (on a phrase, on the bar, or off the beat). **Drag B's waveform** to move where it comes in: it snaps to A's beats (**Shift** for free), with a live readout, and ⌘Z undoes it. **▶ Preview transition** plays the night from a few bars before B. **Sync** (on by default) locks the beats: over the 8 bars before B comes in, A rides its tempo into B's (half and double time allowed, up to ±16%) and holds it through the blend, like riding the pitch fader; B always plays at its own tempo, so its cues and the next transition stay put. A's waveform and grid are drawn as it's ridden, so you can see the beats line up, and dragging B snaps to A's beats as they're played. Riding changes A's pitch a little, as on a turntable. **Blend** picks how the two share the overlap: **Bass swap** (the default on a real overlap: B comes in with its bass cut, the basses swap on one of B's bars halfway through, then A fades out), **Crossfade** (equal power across the overlap), **Straight** (both at full level) or **Echo out** (A echoes out at its out point). The waveforms show it: they shrink as a fader comes down and the lows dim where the bass is cut. **✎ Keyframes** lets you draw the transition yourself: pick **Fader**, **Bass**, **Mid**, **High**, **Filter** (down: low-pass, up: high-pass), **Echo** (a send to a one-beat echo in time with the deck) or **Reverb**, and each deck shows that parameter's curve. Click on a deck to add a keyframe and drag it (time snaps to the incoming track's beats; **Shift** for free, values close to normal click onto normal); double-click or right-click one to remove it. The fader and bass start from the blend style's curve, so you tweak the bass swap rather than start again (the blend then reads **Custom**; picking a style hands them back); the others start as a bump around your click. Keyframes are kept relative to where B comes in, so they move with it; **Clear** removes them all and ⌘Z undoes any change. **⟲ Loop** repeats the transition, and edits are heard straight away, without restarting the tracks. ‹ › steps through the night's transitions; it follows the track you open in the deck, and the night while it plays. **Edit cues** opens either track in the deck. |
| **Deck** | The loaded track: a full-width colour waveform with its sections, and underneath it the eight hot cue pads in one row, the loop and memory cue buttons, and the cue list on the right. ‹ › steps through the night. |
| **Journey of the night** (centre) | A zoomable timeline of the set, from the whole night down to seconds, shown in clock time once the set has a start time. Drag tracks here from the library at the exact moment they should start, and drag them along to move them. Tracks snap to whole seconds and to neighbouring tracks' edges; hold **Shift** for free placement. Alternating lanes show overlaps as blends. It **plays the night as planned**: **▶ Play night** plays every track at its place, from its mix-in, and tracks that overlap on the timeline play together, so what you see is what you hear; one runs straight into the next without stopping. Each block shows the waveform of the part of the track that plays. Click the timeline's background (the ruler, bands or empty lanes) to jump there, or drag along it to scrub the night with sound, even from pause: let go and it plays on if it was playing, or stops where it landed. Opening tracks in the deck while the night plays doesn't stop the music. Chapter bands and the energy line sit above, and the dot on each track shows its key compatibility with the previous one. Click a track to load it into the deck and edit its start time, chapter, energy, transition, notes and mix points; **Delete** removes it. |
| **Library** (bottom) | Your imported collection and playlists. Click a row to load it into the deck, drag it onto the timeline, or double-click to add it at the end of the night. |

A **player bar** floats along the bottom of the whole app: the loaded track with a big clock on the left, a large
play / pause with −1 / +1 bar in the middle, and the out FX strip over the volume and level meter on the right. The
panels keep room for it, and on a short window the deck and timeline give way so the library stays usable.

The top bar keeps it to undo/redo, the set, **Export** and **Import**; the less-used actions live under **⋯**:
**Story & chapters** (story, venue, start time, target length, chapters and the energy arc), the music folder,
**Controller**, **Versions** and ★ Founding DJ. Controls have no outlines: they're soft fills that brighten under the
pointer, and anything switched on (a mode, a toggle, the playing transport) is inverted, light on dark. Keys are colour-coded on the Camelot wheel everywhere:
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

- **Link your music folder** with **♫ Link music folder** in the top bar (once linked, it moves under **⋯**) (also on the start screen, in the
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
- **Undo / redo.** **⌘Z** (Ctrl+Z) undoes the last change anywhere in the app: cue moves, pads, loops, BPM and
  key edits, timeline moves, imports, BPM fixes and more; **⇧⌘Z** (Ctrl+Y) redoes. A whole drag or a typed value
  undoes as one step. The ↶ ↷ buttons in the top bar do the same and show what they'll undo. Inside a text field,
  ⌘Z undoes your typing as usual.
- **Save versions.** Open *Versions* under **⋯** in the top bar, or press **⌘/Ctrl+S** anywhere. A version is a named snapshot
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
  both waveforms, with phrase lines every 16 bars. Section chips under the waveform jump to each part.
- **Auto cues** (✦ next to the section chips) set cue points from those sections: the first downbeat, the drop,
  breakdowns, the build and the outro, on the beat grid, named and coloured by section. When there are more
  sections than pads, the most useful win (start, first drop, outro, first breakdown and build), and they go on
  the pads in time order. When there are fewer sections than pads (a reggaeton or hip-hop track whose bass never
  stops is one long section), the rest are filled from **phrase changes**: every 4-bar line compares the 8 bars
  before and after in each band, so a vocal coming in, the hats dropping out or the chorus lifting all show up.
  They're named *Lift*, *Dip* or *Switch* (or *Phrase* when it's just the next phrase) and kept 16 bars apart where
  possible, so all eight pads get used and spread over the track. Choose **Fill empty pads** (your cues stay put), **Replace pads** (your hot cues become
  memory cues) or **Memory cues** (pads untouched), and optionally add 4-bar mix loops at the intro and outro.
  Preview first, then apply to the track or to **every track in the set** that has a colour waveform. ⌘Z undoes it.
- **Audio engine** on the Web Audio API: cue jumps are instant and sample-accurate, with short fades so they don't
  click. Tapping a filled pad plays from it, like a CDJ. **Loop pads really loop**: tap to engage, tap again (or
  *exit*) to release, and jumping outside the loop releases it too. Loops follow you live as you drag or resize
  them. The round **play / pause** button sits in the middle of the deck bar with −1 / +1 bar either side;
  **Vol** on the right sets the preview volume, and the little meter beside it shows the level actually going to
  your speakers. If the browser holds sound back until you click the page, the deck says so and offers
  *Turn sound on*. Without audio
  you still get the timeline, grid and cue markers.
- **Snap: Free / Beat / Bar.** Choose where cues, loops and clicks land: exactly where you put them (*Free*),
  on the nearest beat, or on the nearest bar. `Q` cycles through the three, and the choice is remembered.
- **Pads A–H** behave like a controller: an empty pad sets a cue at the playhead, a filled pad jumps to its cue.
  Pads fire the moment you press them (not on release) and use the exact audio position, so the marker lands
  where you heard it, even with a large library loaded.
- **Loops** from 1 beat to 8 bars, either on a pad or saved as memory loops. **Memory cues** too.
- **Drag cues anywhere.** Grab a marker (its line or its letter flag) on either waveform and drop it somewhere
  else. The marker lights up and the cursor changes when you're on it; anywhere else, dragging scrubs. It follows
  the snap setting (hold **Shift** for free placement), a readout shows the time and bar while you drag, and
  **Esc** cancels. While playing, the audio holds during the drag and carries on when you let go. Drag a loop's
  right edge to resize it.
- **Drag between pads.** Drop a pad onto another pad to move it; if that pad is taken, the two swap. Drop a pad
  on *make it a memory cue*, or drag a memory cue from the list onto a pad.
- Markers can also be moved precisely in the cue form. Each cue can be edited by name, colour, pad, start time (typed or
  nudged by bar, beat or 10 ms), type, and loop length in beats.
- **Out FX** to hear how a track leaves (the *FX* strip in the player bar): **Echo** (beat-synced echoes; the
  track cuts on the first echo and the echoes ring out), **Reverb** (the track swells into a big reverb, cuts, and
  the reverb tail rings), **Loop** (a loop roll that fades over two bars while a filter sweeps up) and **Spin** (a
  backspin that winds the record down). **Beats** sets the echo time, the reverb swell, the loop length or the
  length of the spin (1/4 to 4 beats), and the **D/W** knob sets dry/wet (left mostly the track, middle both,
  right only the effect; on the loop, how far the filter sweeps). When the deck is stopped, an FX plays one bar
  from the playhead first, so you can park on your mix-out point and hear it. While scrubbing the waveform,
  the FX keys fire straight away from the spot you're on, and the track stays out when you let go.
- **Deck or Night.** The player bar drives one of two players, picked with the **Deck | Night** switch on its
  left: the deck (the loaded track, for cues, loops and FX) or the whole night. On the night, the play button,
  `Space` and your controller's play play the night, **◂ Mix / Mix ▸** jump to just before the previous or next
  track coming in, and the bar shows what's playing (both titles during a blend). Only one plays at a time:
  starting one pauses the other. The out FX work on the night too: they play the outgoing track out while the
  incoming one carries on.
- **▸ Next** plays on through the night: after an out FX the next track in the set comes in while the tail rings
  (from its mix-in cue, or its first downbeat), and when a track ends the next one starts. Its audio is loaded
  ahead of time so there's no gap. Pressing play/pause during an FX stays on the current track.
- Keyboard: `Space` play/pause · `1`–`8` pads · `M` memory cue · `Q` snap Free/Beat/Bar · `←/→` beat
  (`Shift`: bar) · `[` / `]` previous/next cue · `E` echo out · `R` reverb out · `L` loop out · `B` backspin ·
  `Delete` removes the selected cue.
- Editing a track's BPM, key, grid start or file location here fixes that track's details before export.
  **×½ / ×2** next to BPM fix half- or double-time readings (e.g. a 96 BPM reggaeton track read as 192)
  without moving the downbeat. On the timeline, half/double-time mixes (96 → 192) aren't flagged as BPM jumps.
- **Fix BPMs** (library toolbar) checks the whole library at once. Set the slowest and fastest tempo your music
  really has (default 80–160): anything slower is doubled (62 → 124, or ×4 if needed), anything faster is halved
  (192 → 96). Tracks tagged drum & bass, jungle, footwork or hardcore use 100–200, so 174 stays and a half-time
  87 becomes 174. Suspicious BPMs show in amber in the library and are counted on the button. You review the list
  and untick any that are right; those are remembered and stop being flagged. A version is saved first so it can
  be undone, and fixes survive re-importing the collection with the old reading.

### 4. Export

Export has two modes:

- **Collection with your cues** (the default): your tracks with the hot cues, memory cues, loops and grids set
  in Setcraft, to update your DJ software's own collection, whether or not a track is on the timeline. Choose
  the tracks **changed in Setcraft** (any cue, loop, BPM, key or grid you set or edited here, including deleted
  cues; this survives re-imports) or the **whole collection**. A *Setcraft updates* playlist lists the changed
  tracks so they're easy to find, and you can **also add the set** as a playlist in timeline order. For rekordbox,
  Traktor and djay Pro.
- **Playlist only**: an ordered list (the set, an imported playlist, the changed tracks or the library), for any
  target including Serato crates and M3U8.

In both modes, **Add the night's mix points as memory cues** (on whenever the set has a transition) writes the
plan into the tracks, so it's on the waveform when you play the night for real: on the outgoing track, where to
bring the next one in (with the blend and the tempo ride, e.g. *▸ Groove in (bass swap, ride to 120)*) and where
it goes out; on the incoming track, where it comes in from and the bass swap. Positions follow the tempo ride, a
cue already on the same spot isn't doubled, and nothing lands past the end of a file. The night's tracks go along
even if they're otherwise unchanged. Only the export gets them; your cues in Setcraft stay as they are.

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

## DJ controllers

Plug a MIDI DJ controller in over USB, open **Controller** under **⋯** in the top bar and click *Connect controller* (Chrome or
Edge; Safari has no MIDI support). Map it by learning: click **Learn** next to an action and press the button,
move the fader or turn the jog wheel. You can map play/pause, hot cues A–H, the jog wheel (holds the track and
scrubs, playing on when you let go; its encoding is detected while learning, and there's a sensitivity setting),
volume, ±1 bar, a 4-beat loop, loop exit, memory cue, the four out FX and the FX dry/wet, previous/next track in
the night and the snap mode. Mappings are saved in the browser, and the controller reconnects on your next visit.

## Founding DJ pass

Everything is free except full export: without a pass, an export holds up to 3 tracks (enough to check it works
with your DJ software). The **Founding DJ pass** is a one-time purchase that unlocks it, activated by pasting a key
(★ Founding DJ under **⋯** in the top bar). Keys are signed and checked offline. Selling is off until it's set up: see
[SELLING.md](SELLING.md).

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
