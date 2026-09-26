/**
 * rekordbox XML (File → Export Collection in xml format).
 *
 * Reference: https://cdn.rekordbox.com/files/20200410160904/xml_format_list.pdf
 *
 *   <DJ_PLAYLISTS Version="1.0.0">
 *     <PRODUCT Name="rekordbox" …/>
 *     <COLLECTION Entries="n">
 *       <TRACK TrackID Name Artist … AverageBpm Tonality Location>
 *         <TEMPO Inizio Bpm Metro Battito/>
 *         <POSITION_MARK Name Type Start End Num Red Green Blue/>
 *       </TRACK>
 *     </COLLECTION>
 *     <PLAYLISTS><NODE Type="0" Name="ROOT"> … <NODE Type="1" KeyType="0"><TRACK Key/></NODE></NODE></PLAYLISTS>
 *   </DJ_PLAYLISTS>
 *
 * POSITION_MARK Type: 0 cue, 1 fade-in, 2 fade-out, 3 load, 4 loop.
 * Num: -1 memory cue, 0-7 hot cue A-H. Start/End are seconds.
 */
import { CUE_COLORS, uid, type Cue, type GridMarker, type Playlist, type Track } from '../model';
import { normaliseKey } from '../keys';
import { beatLength, round } from '../time';
import {
  attrs,
  child,
  children,
  escapeXml,
  extension,
  fileUrlToPath,
  guessFromFileName,
  num,
  parseXml,
  pathToFileUrl,
  str,
} from '../xml';
import { applyPathRewrite, type ExportFile, type ExportOptions, type ImportResult } from './types';

export function isRekordboxXml(text: string): boolean {
  return /<DJ_PLAYLISTS[\s>]/.test(text.slice(0, 2000));
}

export function importRekordbox(text: string): ImportResult {
  const doc = parseXml(text);
  const root = doc.documentElement;
  if (root.tagName !== 'DJ_PLAYLISTS') throw new Error('Not a rekordbox XML file');
  const warnings: string[] = [];

  const tracks: Track[] = [];
  const byRbId = new Map<string, string>();
  const byLocation = new Map<string, string>();
  const collection = child(root, 'COLLECTION');
  for (const el of collection ? children(collection, 'TRACK') : []) {
    const location = str(el.getAttribute('Location'));
    const path = location ? fileUrlToPath(location) : undefined;
    const guess = path ? guessFromFileName(path) : { artist: '', title: '' };
    const beatGrid: GridMarker[] = children(el, 'TEMPO')
      .map((t) => ({
        position: num(t.getAttribute('Inizio')) ?? 0,
        bpm: num(t.getAttribute('Bpm')) ?? 0,
        beat: num(t.getAttribute('Battito')) ?? 1,
      }))
      .filter((g) => g.bpm > 0);
    const bpm = num(el.getAttribute('AverageBpm')) || beatGrid[0]?.bpm || undefined;

    const track: Track = {
      id: uid('trk'),
      title: str(el.getAttribute('Name')) ?? guess.title,
      artist: str(el.getAttribute('Artist')) ?? guess.artist,
      album: str(el.getAttribute('Album')),
      genre: str(el.getAttribute('Genre')),
      label: str(el.getAttribute('Label')),
      comment: str(el.getAttribute('Comments')),
      key: normaliseKey(str(el.getAttribute('Tonality'))),
      bpm,
      duration: num(el.getAttribute('TotalTime')),
      path,
      gridStart: firstDownbeat(beatGrid),
      beatGrid: beatGrid.length ? beatGrid : undefined,
      cues: readCues(el),
      source: 'rekordbox',
      sourceIds: { rekordbox: el.getAttribute('TrackID') ?? '' },
    };
    tracks.push(track);
    const rbId = el.getAttribute('TrackID');
    if (rbId) byRbId.set(rbId, track.id);
    if (location) byLocation.set(location, track.id);
  }

  const playlists: Playlist[] = [];
  const plRoot = child(root, 'PLAYLISTS');
  const walk = (node: Element, prefix: string) => {
    const type = node.getAttribute('Type');
    const name = node.getAttribute('Name') ?? 'Playlist';
    if (type === '1') {
      const keyType = node.getAttribute('KeyType') ?? '0';
      const ids: string[] = [];
      for (const t of children(node, 'TRACK')) {
        const key = t.getAttribute('Key') ?? '';
        const id = keyType === '1' ? byLocation.get(key) : byRbId.get(key);
        if (id) ids.push(id);
        else warnings.push(`Playlist "${name}" references unknown track ${key}`);
      }
      playlists.push({ id: uid('pl'), name: prefix + name, trackIds: ids, source: 'rekordbox' });
    } else {
      const isRoot = name === 'ROOT' && prefix === '';
      for (const c of children(node, 'NODE')) walk(c, isRoot ? '' : `${prefix}${name} / `);
    }
  };
  if (plRoot) for (const n of children(plRoot, 'NODE')) walk(n, '');

  return { format: 'rekordbox', tracks, playlists, warnings };
}

function firstDownbeat(grid: GridMarker[]): number | undefined {
  const g = grid[0];
  if (!g) return undefined;
  // Walk forward to the next beat 1 if the first marker isn't on a downbeat.
  const beatsToDownbeat = (5 - g.beat) % 4;
  return round(g.position + beatsToDownbeat * beatLength(g.bpm), 3);
}

function readCues(el: Element): Cue[] {
  const cues: Cue[] = [];
  const seen = new Set<string>();
  for (const pm of children(el, 'POSITION_MARK')) {
    const type = pm.getAttribute('Type');
    if (type !== '0' && type !== '4') continue; // fades / load markers aren't cues we edit
    const start = num(pm.getAttribute('Start'));
    if (start === undefined) continue;
    const slotNum = num(pm.getAttribute('Num')) ?? -1;
    const slot = slotNum >= 0 && slotNum <= 7 ? slotNum : null;
    const end = type === '4' ? num(pm.getAttribute('End')) : undefined;
    const dedupeKey = `${type}|${slot}|${start}|${end}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const r = num(pm.getAttribute('Red'));
    const g = num(pm.getAttribute('Green'));
    const b = num(pm.getAttribute('Blue'));
    const color =
      r !== undefined && g !== undefined && b !== undefined
        ? rgbToHex(r, g, b)
        : CUE_COLORS[slot ?? (type === '4' ? 1 : 0)];
    cues.push({
      id: uid('cue'),
      kind: type === '4' && end !== undefined && end > start ? 'loop' : 'cue',
      slot,
      start,
      end: type === '4' && end !== undefined && end > start ? end : undefined,
      name: pm.getAttribute('Name') ?? '',
      color,
    });
  }
  return cues;
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [230, 40, 40];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const KIND: Record<string, string> = {
  mp3: 'MP3 File',
  wav: 'WAV File',
  aif: 'AIFF File',
  aiff: 'AIFF File',
  flac: 'FLAC File',
  m4a: 'M4A File',
  mp4: 'M4A File',
  aac: 'AAC File',
  ogg: 'OGG File',
};

export function exportRekordbox(
  tracks: Track[],
  playlists: { name: string; trackIds: string[] }[],
  opts: ExportOptions,
): ExportFile {
  // rekordbox requires integer TrackIDs. Keep the original ones when they are
  // unique integers so re-importing into the same library lines up.
  const used = new Set<number>();
  const rbIds = new Map<string, number>();
  for (const t of tracks) {
    const orig = Number(t.sourceIds?.rekordbox);
    if (Number.isInteger(orig) && orig > 0 && !used.has(orig)) {
      used.add(orig);
      rbIds.set(t.id, orig);
    }
  }
  let next = Math.max(0, ...used) + 1;
  for (const t of tracks) if (!rbIds.has(t.id)) rbIds.set(t.id, next++);

  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<DJ_PLAYLISTS Version="1.0.0">');
  out.push(`  <PRODUCT${attrs({ Name: 'Setcraft', Version: '0.1.0', Company: 'Setcraft' })}/>`);
  out.push(`  <COLLECTION Entries="${tracks.length}">`);
  for (const t of tracks) {
    const path = applyPathRewrite(t.path, opts);
    const trackAttrs = attrs({
      TrackID: rbIds.get(t.id),
      Name: t.title,
      Artist: t.artist,
      Album: t.album,
      Genre: t.genre,
      Kind: KIND[extension(path)],
      TotalTime: t.duration !== undefined ? Math.round(t.duration) : undefined,
      AverageBpm: t.bpm ? t.bpm.toFixed(2) : undefined,
      Tonality: t.key,
      Label: t.label,
      Comments: t.comment,
      Location: path ? pathToFileUrl(path) : undefined,
    });
    out.push(`    <TRACK${trackAttrs}>`);
    for (const g of gridFor(t)) {
      out.push(
        `      <TEMPO${attrs({ Inizio: g.position.toFixed(3), Bpm: g.bpm.toFixed(2), Metro: '4/4', Battito: g.beat })}/>`,
      );
    }
    for (const c of sortCues(t.cues)) {
      // rekordbox always writes Name, even when empty.
      const base = {
        Type: c.kind === 'loop' ? 4 : 0,
        Start: c.start.toFixed(3),
        End: c.kind === 'loop' && c.end !== undefined ? c.end.toFixed(3) : undefined,
        Num: c.slot ?? -1,
      };
      if (c.slot !== null) {
        const [r, g, b] = hexToRgb(c.color);
        out.push(`      <POSITION_MARK Name="${escapeXml(c.name)}"${attrs({ ...base, Red: r, Green: g, Blue: b })}/>`);
      } else {
        out.push(`      <POSITION_MARK Name="${escapeXml(c.name)}"${attrs(base)}/>`);
      }
    }
    out.push('    </TRACK>');
  }
  out.push('  </COLLECTION>');
  out.push('  <PLAYLISTS>');
  out.push(`    <NODE Type="0" Name="ROOT" Count="${playlists.length}">`);
  for (const pl of playlists) {
    const ids = pl.trackIds.filter((id) => rbIds.has(id));
    out.push(`      <NODE${attrs({ Name: pl.name, Type: 1, KeyType: 0, Entries: ids.length })}>`);
    for (const id of ids) out.push(`        <TRACK Key="${rbIds.get(id)}"/>`);
    out.push('      </NODE>');
  }
  out.push('    </NODE>');
  out.push('  </PLAYLISTS>');
  out.push('</DJ_PLAYLISTS>');

  return { fileName: `${safeName(opts.playlistName)}.rekordbox.xml`, mime: 'application/xml', data: out.join('\n') + '\n' };
}

function gridFor(t: Track): GridMarker[] {
  if (t.beatGrid?.length) return t.beatGrid;
  if (t.bpm && t.gridStart !== undefined) return [{ position: t.gridStart, bpm: t.bpm, beat: 1 }];
  return [];
}

export function sortCues(cues: Cue[]): Cue[] {
  return [...cues].sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99) || a.start - b.start);
}

export function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'setcraft';
}
