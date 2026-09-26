/**
 * Traktor NML (collection.nml, or File → Export Playlist).
 *
 *   <NML VERSION="19">
 *     <COLLECTION ENTRIES="n">
 *       <ENTRY TITLE ARTIST>
 *         <LOCATION DIR="/:Users/:me/:Music/:" FILE="a.mp3" VOLUME="Macintosh HD"/>
 *         <INFO GENRE LABEL COMMENT KEY PLAYTIME/>
 *         <TEMPO BPM/>
 *         <MUSICAL_KEY VALUE="0-23"/>
 *         <CUE_V2 NAME DISPL_ORDER TYPE START LEN REPEATS HOTCUE><GRID BPM/></CUE_V2>
 *       </ENTRY>
 *     </COLLECTION>
 *     <PLAYLISTS><NODE TYPE="FOLDER" NAME="$ROOT"><SUBNODES>
 *       <NODE TYPE="PLAYLIST" NAME><PLAYLIST TYPE="LIST"><ENTRY><PRIMARYKEY TYPE="TRACK" KEY="vol/:dir/:file"/></ENTRY></PLAYLIST></NODE>
 *     </SUBNODES></NODE></PLAYLISTS>
 *   </NML>
 *
 * CUE_V2 TYPE: 0 cue, 1 fade-in, 2 fade-out, 3 load, 4 grid, 5 loop.
 * START / LEN are milliseconds. HOTCUE -1 = not on a pad, 0-7 = pad 1-8.
 */
import { CUE_COLORS, uid, type Cue, type Playlist, type Track } from '../model';
import { fromTraktorKeyValue, normaliseKey, toTraktorKeyValue } from '../keys';
import { attrs, child, children, escapeXml, guessFromFileName, num, parseXml, str } from '../xml';
import { applyPathRewrite, type ExportFile, type ExportOptions, type ImportResult } from './types';
import { safeName, sortCues } from './rekordbox';

export function isTraktorNml(text: string): boolean {
  return /<NML[\s>]/.test(text.slice(0, 2000));
}

const MAC_ROOT_DIRS = new Set(['Users', 'Applications', 'Library', 'System', 'private', 'opt', 'Volumes']);

export function locationToPath(volume: string, dir: string, file: string): string {
  const segs = dir.split('/:').filter(Boolean);
  if (/^[A-Za-z]:$/.test(volume)) return [volume, ...segs, file].join('/');
  if (!volume || MAC_ROOT_DIRS.has(segs[0])) return '/' + [...segs, file].join('/');
  return '/' + ['Volumes', volume, ...segs, file].join('/');
}

export function pathToLocation(
  path: string,
  bootVolume: string,
): { volume: string; dir: string; file: string } {
  const p = path.replace(/\\/g, '/');
  let segs = p.split('/').filter(Boolean);
  let volume: string;
  if (/^[A-Za-z]:$/.test(segs[0] ?? '')) {
    volume = segs[0].toUpperCase();
    segs = segs.slice(1);
  } else if (segs[0] === 'Volumes' && segs.length > 2) {
    volume = segs[1];
    segs = segs.slice(2);
  } else {
    volume = bootVolume;
  }
  const file = segs.pop() ?? '';
  const dir = '/:' + segs.map((s) => s + '/:').join('');
  return { volume, dir, file };
}

export function importTraktor(text: string): ImportResult {
  const doc = parseXml(text);
  const root = doc.documentElement;
  if (root.tagName !== 'NML') throw new Error('Not a Traktor NML file');
  const warnings: string[] = [];

  const tracks: Track[] = [];
  const byKey = new Map<string, string>();
  const collection = child(root, 'COLLECTION');
  for (const el of collection ? children(collection, 'ENTRY') : []) {
    const loc = child(el, 'LOCATION');
    const volume = loc?.getAttribute('VOLUME') ?? '';
    const dir = loc?.getAttribute('DIR') ?? '';
    const file = loc?.getAttribute('FILE') ?? '';
    const path = file ? locationToPath(volume, dir, file) : undefined;
    const guess = path ? guessFromFileName(path) : { artist: '', title: '' };
    const info = child(el, 'INFO');
    const tempo = child(el, 'TEMPO');
    const keyValue = num(child(el, 'MUSICAL_KEY')?.getAttribute('VALUE'));

    let gridStart: number | undefined;
    let gridBpm: number | undefined;
    const cues: Cue[] = [];
    for (const c of children(el, 'CUE_V2')) {
      const type = c.getAttribute('TYPE');
      const start = (num(c.getAttribute('START')) ?? 0) / 1000;
      if (type === '4') {
        if (gridStart === undefined) {
          gridStart = start;
          gridBpm = num(child(c, 'GRID')?.getAttribute('BPM'));
        }
        continue;
      }
      if (type !== '0' && type !== '5') continue;
      const hot = num(c.getAttribute('HOTCUE')) ?? -1;
      const slot = hot >= 0 && hot <= 7 ? hot : null;
      const len = (num(c.getAttribute('LEN')) ?? 0) / 1000;
      const isLoop = type === '5' && len > 0;
      const rawName = c.getAttribute('NAME') ?? '';
      cues.push({
        id: uid('cue'),
        kind: isLoop ? 'loop' : 'cue',
        slot,
        start,
        end: isLoop ? start + len : undefined,
        name: rawName === 'n.n.' ? '' : rawName,
        color: CUE_COLORS[slot ?? (isLoop ? 1 : 0)],
      });
    }

    const track: Track = {
      id: uid('trk'),
      title: str(el.getAttribute('TITLE')) ?? guess.title,
      artist: str(el.getAttribute('ARTIST')) ?? guess.artist,
      album: str(child(el, 'ALBUM')?.getAttribute('TITLE')),
      genre: str(info?.getAttribute('GENRE')),
      label: str(info?.getAttribute('LABEL')),
      comment: str(info?.getAttribute('COMMENT')),
      key:
        (keyValue !== undefined ? fromTraktorKeyValue(keyValue) : undefined) ??
        normaliseKey(str(info?.getAttribute('KEY'))),
      bpm: num(tempo?.getAttribute('BPM')) ?? gridBpm,
      duration: num(info?.getAttribute('PLAYTIME_FLOAT')) ?? num(info?.getAttribute('PLAYTIME')),
      path,
      gridStart,
      cues,
      source: 'traktor',
      sourceIds: volume ? { traktorVolume: volume } : {},
    };
    tracks.push(track);
    if (file) byKey.set(volume + dir + file, track.id);
  }

  const playlists: Playlist[] = [];
  const walk = (node: Element, prefix: string) => {
    const type = node.getAttribute('TYPE');
    const name = node.getAttribute('NAME') ?? 'Playlist';
    if (type === 'PLAYLIST') {
      const pl = child(node, 'PLAYLIST');
      const ids: string[] = [];
      for (const e of pl ? children(pl, 'ENTRY') : []) {
        const key = child(e, 'PRIMARYKEY')?.getAttribute('KEY') ?? '';
        const id = byKey.get(key);
        if (id) ids.push(id);
        else if (key) warnings.push(`Playlist "${name}" references a track not in the collection: ${key}`);
      }
      playlists.push({ id: uid('pl'), name: prefix + name, trackIds: ids, source: 'traktor' });
    } else if (type === 'FOLDER') {
      const sub = child(node, 'SUBNODES');
      const nextPrefix = name === '$ROOT' ? prefix : `${prefix}${name} / `;
      for (const c of sub ? children(sub, 'NODE') : []) walk(c, nextPrefix);
    }
  };
  const plRoot = child(root, 'PLAYLISTS');
  if (plRoot) for (const n of children(plRoot, 'NODE')) walk(n, '');

  return { format: 'traktor', tracks, playlists, warnings };
}

export function exportTraktor(
  tracks: Track[],
  playlists: { name: string; trackIds: string[] }[],
  opts: ExportOptions,
): ExportFile {
  const locs = new Map<string, { volume: string; dir: string; file: string }>();
  for (const t of tracks) {
    const path = applyPathRewrite(t.path, opts);
    if (!path) continue;
    const boot = opts.macVolumeName || t.sourceIds?.traktorVolume || 'Macintosh HD';
    locs.set(t.id, pathToLocation(path, boot));
  }
  const ms = (sec: number) => (sec * 1000).toFixed(6);

  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="no" ?>');
  out.push('<NML VERSION="19"><HEAD COMPANY="www.native-instruments.com" PROGRAM="Traktor"></HEAD>');
  out.push('<MUSICFOLDERS></MUSICFOLDERS>');
  const exportable = tracks.filter((t) => locs.has(t.id));
  out.push(`<COLLECTION ENTRIES="${exportable.length}">`);
  for (const t of exportable) {
    const loc = locs.get(t.id)!;
    out.push(`<ENTRY${attrs({ TITLE: t.title, ARTIST: t.artist })}>`);
    out.push(`<LOCATION${attrs({ DIR: loc.dir, FILE: loc.file, VOLUME: loc.volume, VOLUMEID: loc.volume })}></LOCATION>`);
    if (t.album) out.push(`<ALBUM${attrs({ TITLE: t.album })}></ALBUM>`);
    out.push(
      `<INFO${attrs({
        GENRE: t.genre,
        LABEL: t.label,
        COMMENT: t.comment,
        KEY: t.key,
        PLAYTIME: t.duration !== undefined ? Math.round(t.duration) : undefined,
        PLAYTIME_FLOAT: t.duration !== undefined ? t.duration.toFixed(6) : undefined,
      })}></INFO>`,
    );
    if (t.bpm) out.push(`<TEMPO BPM="${t.bpm.toFixed(6)}" BPM_QUALITY="100.000000"></TEMPO>`);
    const kv = toTraktorKeyValue(t.key);
    if (kv !== undefined) out.push(`<MUSICAL_KEY VALUE="${kv}"></MUSICAL_KEY>`);
    if (t.bpm && t.gridStart !== undefined) {
      out.push(
        `<CUE_V2 NAME="AutoGrid" DISPL_ORDER="0" TYPE="4" START="${ms(t.gridStart)}" LEN="0.000000" REPEATS="-1" HOTCUE="-1"><GRID BPM="${t.bpm.toFixed(6)}"></GRID></CUE_V2>`,
      );
    }
    sortCues(t.cues).forEach((c, i) => {
      const isLoop = c.kind === 'loop' && c.end !== undefined;
      out.push(
        `<CUE_V2${attrs({
          NAME: c.name || 'n.n.',
          DISPL_ORDER: i + 1,
          TYPE: isLoop ? 5 : 0,
          START: ms(c.start),
          LEN: isLoop ? ms(c.end! - c.start) : '0.000000',
          REPEATS: -1,
          HOTCUE: c.slot ?? -1,
        })}></CUE_V2>`,
      );
    });
    out.push('</ENTRY>');
  }
  out.push('</COLLECTION>');
  out.push('<SETS ENTRIES="0"></SETS>');
  out.push('<PLAYLISTS><NODE TYPE="FOLDER" NAME="$ROOT">');
  out.push(`<SUBNODES COUNT="${playlists.length}">`);
  for (const pl of playlists) {
    const ids = pl.trackIds.filter((id) => locs.has(id));
    out.push(`<NODE TYPE="PLAYLIST" NAME="${escapeXml(pl.name)}">`);
    out.push(`<PLAYLIST ENTRIES="${ids.length}" TYPE="LIST" UUID="${uuidHex()}">`);
    for (const id of ids) {
      const l = locs.get(id)!;
      out.push(`<ENTRY><PRIMARYKEY TYPE="TRACK" KEY="${escapeXml(l.volume + l.dir + l.file)}"></PRIMARYKEY></ENTRY>`);
    }
    out.push('</PLAYLIST></NODE>');
  }
  out.push('</SUBNODES></NODE></PLAYLISTS>');
  out.push('<INDEXING></INDEXING>');
  out.push('</NML>');

  return { fileName: `${safeName(opts.playlistName)}.nml`, mime: 'application/xml', data: out.join('\n') + '\n' };
}

function uuidHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
