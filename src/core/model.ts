/**
 * Software-neutral data model. Every importer converts into these shapes and
 * every exporter converts out of them, so a cue set in the app can travel from
 * any supported DJ program to any other.
 *
 * All positions are in seconds from the start of the audio file.
 */

import type { BlendStyle, TransitionAutomation } from './mixplan';

export type SourceFormat = 'rekordbox' | 'traktor' | 'serato' | 'djay' | 'm3u' | 'csv' | 'manual';

export type CueKind = 'cue' | 'loop';

export interface Cue {
  id: string;
  kind: CueKind;
  /** Hot cue pad index 0-7 (A-H). `null` means a memory cue / stored loop. */
  slot: number | null;
  start: number;
  /** Loop end, seconds. Only set for loops. */
  end?: number;
  name: string;
  /** `#rrggbb` */
  color: string;
  /** Where the cue came from: the importing program, or 'manual' when set in Setcraft. */
  origin?: SourceFormat;
  /** Changed in Setcraft after import. Edited cues win merge conflicts. */
  edited?: boolean;
  /**
   * Kept on purpose after it disappeared from the program it came from, so
   * later imports from that program don't flag it again.
   */
  pinned?: boolean;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  genre?: string;
  label?: string;
  comment?: string;
  /** Musical key in standard notation, e.g. "Am", "F#", "Bbm". */
  key?: string;
  bpm?: number;
  /**
   * Half / double-time correction made in Setcraft (2 = doubled, 0.5 = halved),
   * so re-importing the DJ software's original reading doesn't undo it.
   */
  tempoFix?: number;
  /** The DJ checked this BPM and it's right, even though it's outside their usual range. */
  bpmConfirmed?: boolean;
  /** Cues, loops, tempo, grid, key or details were changed in Setcraft: exported with the collection. */
  modified?: boolean;
  /** Seconds. */
  duration?: number;
  /** Absolute path on the DJ's machine, POSIX or Windows style. */
  path?: string;
  /** First downbeat of the beat grid, seconds. */
  gridStart?: number;
  /** Full tempo map when the source has one (rekordbox dynamic grids). */
  beatGrid?: GridMarker[];
  cues: Cue[];
  source: SourceFormat;
  /** Opaque ids from the source software, kept so round-trips stay stable. */
  sourceIds?: Record<string, string>;
  /**
   * Decoder offsets learned while merging, in ms: a cue at library time `t`
   * sits at `t + offset` in that program. Applied automatically on export.
   */
  sourceOffsets?: Partial<Record<SourceFormat, number>>;
}

export interface GridMarker {
  /** Seconds. */
  position: number;
  bpm: number;
  /** Beat in bar at this marker, 1-4. */
  beat: number;
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  source: SourceFormat;
}

export interface Chapter {
  id: string;
  name: string;
  /** What the crowd should feel during this part of the set. */
  intent: string;
  color: string;
}

export interface SetEntry {
  id: string;
  trackId: string;
  chapterId: string;
  /** Planned energy, 1-10. */
  energy: number;
  /** How to get *into* this track from the previous one. */
  transition: string;
  notes: string;
  /** Cue ids on the track used as the mix-in / mix-out points. */
  mixInCueId?: string;
  mixOutCueId?: string;
  /** How this track is mixed in from the previous one (default: a bass swap when they overlap). */
  blend?: BlendStyle;
  /** Ride the previous track's tempo into this one's so the beats lock (default on). */
  sync?: boolean;
  /** Keyframes for the transition into this track (fader, EQ, filter, echo, reverb on either deck). */
  automation?: TransitionAutomation;
  /**
   * When this track starts, in seconds from the start of the set. Entries from
   * older versions don't have it and are laid out one after another.
   */
  at?: number;
}

export interface SetPlan {
  id: string;
  name: string;
  venue: string;
  /** The story of the set, in the DJ's own words. */
  story: string;
  targetMinutes: number;
  /** Clock time the set starts, "HH:MM" (e.g. "22:00"), for showing real times on the timeline. */
  startClock?: string;
  chapters: Chapter[];
  entries: SetEntry[];
}

export interface Library {
  tracks: Record<string, Track>;
  playlists: Playlist[];
}

export interface Project {
  version: 1;
  library: Library;
  sets: SetPlan[];
  activeSetId: string | null;
}

/** Colors of rekordbox's hot cue palette, reused as the app-wide default. */
export const CUE_COLORS = [
  '#e62828', // red
  '#ff8c00', // orange
  '#e0c000', // yellow
  '#28e214', // green
  '#10b1f6', // aqua
  '#305aff', // blue
  '#aa72ff', // purple
  '#ff47ae', // pink
] as const;

export const SLOT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export const MAX_HOT_CUES = 8;

let counter = 0;
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${counter.toString(36)}`;
}

export function emptyLibrary(): Library {
  return { tracks: {}, playlists: [] };
}

export function defaultChapters(): Chapter[] {
  return [
    { id: uid('ch'), name: 'Warm-up', intent: 'Invite people in. Groove over drama.', color: '#10b1f6' },
    { id: uid('ch'), name: 'Build', intent: 'Raise tension, tighten the groove.', color: '#e0c000' },
    { id: uid('ch'), name: 'Peak', intent: 'Full release. Biggest records.', color: '#e62828' },
    { id: uid('ch'), name: 'Cool-down', intent: 'Land the plane. Leave them wanting more.', color: '#aa72ff' },
  ];
}

export function newSet(name = 'Untitled set'): SetPlan {
  return {
    id: uid('set'),
    name,
    venue: '',
    story: '',
    targetMinutes: 60,
    chapters: defaultChapters(),
    entries: [],
  };
}

export function emptyProject(): Project {
  const set = newSet('My first set');
  return { version: 1, library: emptyLibrary(), sets: [set], activeSetId: set.id };
}

/**
 * Stable identity for de-duplicating the same file imported from different
 * programs: normalised path when known, otherwise artist + title.
 */
export function trackIdentity(t: Pick<Track, 'path' | 'artist' | 'title'>): string {
  if (t.path) return 'p:' + normalisePath(t.path).toLowerCase();
  return 'm:' + `${t.artist}\u0000${t.title}`.toLowerCase().trim();
}

export function normalisePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Track fields a DJ edits; changing any of them marks the track as changed in Setcraft. */
export const EDITABLE_TRACK_FIELDS: readonly (keyof Track)[] = [
  'cues',
  'bpm',
  'beatGrid',
  'gridStart',
  'key',
  'tempoFix',
  'path',
  'title',
  'artist',
  'album',
  'genre',
  'label',
  'comment',
];

/** Whether a track has changes made in Setcraft that the DJ software doesn't have yet. */
export function isChangedInSetcraft(t: Track): boolean {
  return !!t.modified || t.tempoFix !== undefined || t.cues.some((c) => c.origin === 'manual' || c.edited);
}
