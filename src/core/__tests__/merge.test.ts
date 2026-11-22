import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportFor } from '../formats';
import { importRekordbox } from '../formats/rekordbox';
import { importTraktor } from '../formats/traktor';
import { detectOffset, mergeCues, mergeIntoLibrary, planMerge, planTrackMerge, applyTrackMerge } from '../merge';
import { emptyLibrary, type Cue, type SourceFormat, type Track } from '../model';
import { markEdits } from '../../ui/store';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

let n = 0;
const cue = (start: number, slot: number | null, origin: SourceFormat, extra: Partial<Cue> = {}): Cue => ({
  id: `c${n++}`,
  kind: 'cue',
  slot,
  start,
  name: '',
  color: '#e62828',
  origin,
  ...extra,
});
const track = (cues: Cue[], extra: Partial<Track> = {}): Track => ({
  id: `t${n++}`,
  title: 'T',
  artist: 'A',
  path: '/music/t.mp3',
  cues,
  source: 'rekordbox',
  ...extra,
});

describe('smart cue merge', () => {
  it('keeps rekordbox cues missing from Traktor and keeps rekordbox colours', () => {
    const rb = importRekordbox(fixture('rekordbox.xml'));
    const tk = importTraktor(fixture('traktor.nml'));
    const { library } = mergeIntoLibrary(mergeIntoLibrary(emptyLibrary(), rb).library, tk);
    const alpha = Object.values(library.tracks).find((t) => t.title === 'Opening Theme')!;
    expect(alpha.cues.map((c) => [c.slot, c.name]).sort()).toEqual(
      [[0, 'Intro'], [1, 'Drop'], [2, 'Outro loop'], [null, '']].sort(),
    );
    expect(alpha.cues.find((c) => c.slot === 0)!.color).toBe('#28e214');
    expect(alpha.sourceOffsets).toBeUndefined();

    const plan = planMerge(mergeIntoLibrary(emptyLibrary(), rb).library, tk);
    expect(plan.matches.find((m) => m.existing.title === 'Opening Theme')!.needsReview).toBe(false);
  });

  it('detects a decoder offset, aligns to it and re-applies it on export', () => {
    const existing = track([cue(10, 0, 'rekordbox'), cue(20, 1, 'rekordbox'), cue(30, null, 'rekordbox')]);
    const incoming = track(
      [cue(10.026, 0, 'traktor'), cue(20.026, 1, 'traktor'), cue(30.026, null, 'traktor'), cue(40.026, 2, 'traktor', { name: 'New' })],
      { source: 'traktor' },
    );
    expect(detectOffset(existing, incoming)!.seconds).toBeCloseTo(0.026);

    const plan = planTrackMerge(existing, incoming, 'traktor');
    expect(plan).toMatchObject({ offsetMs: 26, offsetDetected: true, needsReview: true });
    const merged = applyTrackMerge(plan, 'smart');
    expect(merged.cues.map((c) => c.start)).toEqual([10, 20, 30, 40]);
    expect(merged.sourceOffsets).toEqual({ traktor: 26 });

    const nml = exportFor('traktor', [merged], [merged.id], { playlistName: 'x' }).file.data as string;
    expect(nml).toContain('START="40026.000000"');
    const xml = exportFor('rekordbox', [merged], [merged.id], { playlistName: 'x' }).file.data as string;
    expect(xml).toContain('Start="40.000"');
  });

  it('uses the grid to detect an offset when only one cue pair exists', () => {
    const existing = track([cue(10, 0, 'rekordbox')], { bpm: 128, gridStart: 0.1 });
    const incoming = track([cue(10.03, 0, 'traktor')], { bpm: 128, gridStart: 0.1 + 60 / 128 + 0.03 });
    expect(detectOffset(existing, incoming)!.seconds).toBeCloseTo(0.03);
  });

  it('lets cues edited in Setcraft win', () => {
    const mine = cue(10, 0, 'rekordbox', { name: 'Mine', edited: true });
    const r = mergeCues([mine], [cue(10.02, 3, 'rekordbox', { name: 'Theirs' })], 'rekordbox');
    expect(r.cues).toEqual([mine]);
  });

  it('takes updates when re-importing from the same program', () => {
    const r = mergeCues([cue(10, 0, 'rekordbox')], [cue(10.02, 0, 'rekordbox', { name: 'Vocal', color: '#305aff' })], 'rekordbox');
    expect(r.cues[0]).toMatchObject({ start: 10.02, name: 'Vocal', color: '#305aff' });
    expect(r.changes[0]).toMatchObject({ kind: 'matched', fields: ['position', 'name', 'color'] });
  });

  it('only fills gaps from a different program', () => {
    const r = mergeCues(
      [cue(10, null, 'rekordbox', { name: 'Keep' }), cue(20, 1, 'rekordbox')],
      [cue(10, 4, 'traktor', { name: 'Other', color: '#aaaaaa' }), cue(20, null, 'traktor', { name: 'Filled' })],
      'traktor',
    );
    expect(r.cues[0]).toMatchObject({ slot: 4, name: 'Keep', color: '#e62828' }); // memory cue gains a pad
    expect(r.cues[1]).toMatchObject({ slot: 1, name: 'Filled' });
  });

  it('never deletes on its own: cues gone from their program are kept, flagged and pinned', () => {
    const gone = cue(20, 1, 'rekordbox');
    const r = mergeCues(
      [
        cue(10, 0, 'rekordbox'),
        gone, // deleted in rekordbox
        cue(30, 2, 'rekordbox', { edited: true }), // edited here: not flagged
        cue(40, 3, 'manual'),
        cue(50, 4, 'traktor'),
      ],
      [cue(10, 0, 'rekordbox')],
      'rekordbox',
    );
    expect(r.cues.map((c) => c.start)).toEqual([10, 20, 30, 40, 50]);
    expect(r.changes.filter((c) => c.kind === 'missing').map((c) => c.cue.id)).toEqual([gone.id]);
    expect(r.changes.some((c) => c.kind === 'removed')).toBe(false);
    expect(r.cues.find((c) => c.id === gone.id)!.pinned).toBe(true);

    // Importing the same file again doesn't flag it a second time.
    const again = mergeCues(r.cues, [cue(10, 0, 'rekordbox')], 'rekordbox');
    expect(again.changes.some((c) => c.kind === 'missing')).toBe(false);
    expect(again.cues).toHaveLength(5);
  });

  it('removes a missing cue only when the DJ ticks it, and reuses its pad', () => {
    const gone = cue(20, 1, 'rekordbox');
    const incoming = [cue(10, 0, 'rekordbox'), cue(80, 1, 'rekordbox', { name: 'New B' })];
    const kept = mergeCues([cue(10, 0, 'rekordbox'), gone], incoming, 'rekordbox');
    expect(kept.cues.find((c) => c.name === 'New B')!.slot).toBe(2); // pad B still held by the kept cue

    const removed = mergeCues([cue(10, 0, 'rekordbox'), gone], incoming, 'rekordbox', 0, new Set([gone.id]));
    expect(removed.cues.some((c) => c.id === gone.id)).toBe(false);
    expect(removed.cues.find((c) => c.name === 'New B')!.slot).toBe(1);
    expect(removed.changes.find((c) => c.kind === 'removed')!.cue.id).toBe(gone.id);
  });

  it('flags missing cues for review and applies removals chosen per track', () => {
    const gone = cue(20, 1, 'rekordbox');
    const existing = track([cue(10, 0, 'rekordbox'), gone]);
    const incoming = track([cue(10, 0, 'rekordbox')]);
    const plan = planTrackMerge(existing, incoming, 'rekordbox');
    expect(plan.needsReview).toBe(true);
    expect(applyTrackMerge(plan, 'smart').cues).toHaveLength(2);
    expect(applyTrackMerge(plan, 'smart', [gone.id]).cues).toHaveLength(1);

    const lib = { tracks: { [existing.id]: existing }, playlists: [] };
    const res = { format: 'rekordbox' as const, tracks: [incoming], playlists: [] };
    expect(mergeIntoLibrary(lib, res).library.tracks[existing.id].cues).toHaveLength(2);
    const chosen = mergeIntoLibrary(lib, res, { strategy: 'smart', remove: { [incoming.id]: [gone.id] } });
    expect(chosen.library.tracks[existing.id].cues).toHaveLength(1);
  });

  it('un-pins a kept cue when it comes back in the file', () => {
    const r = mergeCues([cue(20, 1, 'rekordbox', { pinned: true })], [cue(20, 1, 'rekordbox')], 'rekordbox');
    expect(r.cues[0].pinned).toBeUndefined();
  });

  it('never deletes cues because of a file format that has no cues', () => {
    const r = mergeCues([cue(20, 1, 'serato')], [], 'serato');
    expect(r.cues).toHaveLength(1);
  });

  it('resolves pad conflicts by moving, then demoting', () => {
    const r = mergeCues(
      [cue(5, 0, 'manual', { edited: true })],
      [cue(50, 0, 'rekordbox', { name: 'Drop' }), cue(60, 1, 'rekordbox')],
      'rekordbox',
    );
    // B is wanted by an incoming cue, so the displaced one goes to C, not B.
    expect(r.cues.map((c) => [c.start, c.slot])).toEqual([[5, 0], [50, 2], [60, 1]]);
    expect(r.changes.find((c) => c.kind === 'moved')).toMatchObject({ fromSlot: 0, toSlot: 2 });

    const full = Array.from({ length: 8 }, (_, i) => cue(100 + i, i, 'manual', { edited: true }));
    const r2 = mergeCues(full, [cue(5, 3, 'rekordbox')], 'rekordbox');
    expect(r2.cues.find((c) => c.start === 5)!.slot).toBeNull();
    expect(r2.changes.some((c) => c.kind === 'demoted')).toBe(true);
    expect(r2.cues).toHaveLength(9);
  });

  it('is stable: re-importing the same file after a pad move changes nothing', () => {
    const existing = [cue(5, 0, 'manual', { edited: true })];
    const incoming = [cue(50, 0, 'rekordbox', { name: 'Drop' })];
    const first = mergeCues(existing, incoming, 'rekordbox');
    const second = mergeCues(first.cues, incoming, 'rekordbox');
    expect(second.cues).toEqual(first.cues);
    expect(second.changes.every((c) => c.kind === 'kept' || (c.kind === 'matched' && c.fields.length === 0))).toBe(true);
    const plan = planTrackMerge(track(first.cues), track(incoming), 'rekordbox');
    expect(plan.needsReview).toBe(false);
  });

  it('matches one-to-one, hot to hot and memory to memory', () => {
    const r = mergeCues(
      [cue(10, 0, 'rekordbox', { name: 'hot' }), cue(10, null, 'rekordbox', { name: 'mem' })],
      [cue(10, null, 'traktor'), cue(10, 0, 'traktor')],
      'traktor',
    );
    expect(r.cues).toHaveLength(2);
    expect(r.changes.every((c) => c.kind === 'matched')).toBe(true);
  });

  it('supports keep-mine and take-theirs', () => {
    const existing = track([cue(10, 0, 'manual', { name: 'Mine' })], { gridStart: 0.1, bpm: 120 });
    const incoming = track([cue(30, 0, 'rekordbox', { name: 'Theirs' })], { gridStart: 0.2, bpm: 121, key: 'Am' });
    const plan = planTrackMerge(existing, incoming, 'rekordbox');
    const keep = applyTrackMerge(plan, 'keep');
    expect(keep.cues.map((c) => c.name)).toEqual(['Mine']);
    expect(keep).toMatchObject({ gridStart: 0.1, bpm: 121, key: 'Am', id: existing.id });
    const replace = applyTrackMerge(plan, 'replace');
    expect(replace.cues.map((c) => c.name)).toEqual(['Theirs']);
    expect(replace.gridStart).toBe(0.2);
    const smart = applyTrackMerge(plan, 'smart');
    expect(smart.cues.map((c) => [c.name, c.slot])).toEqual([['Mine', 0], ['Theirs', 1]]);
  });
});

describe('edit tracking', () => {
  it('marks new cues as manual and changed ones as edited', () => {
    const a = cue(10, 0, 'rekordbox');
    const b = cue(20, 1, 'rekordbox');
    const out = markEdits([a, b], [{ ...a, name: 'x' }, b, { ...cue(30, 2, 'manual'), origin: undefined }]);
    expect(out[0].edited).toBe(true);
    expect(out[1].edited).toBeUndefined();
    expect(out[2].origin).toBe('manual');
  });
});
