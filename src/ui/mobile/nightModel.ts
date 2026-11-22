import { useEffect, useState, useSyncExternalStore } from 'react';
import { formatSetTime, itemMixIn, itemStretch, parseClock, type TimelineItem } from '../../core/setplan';
import { useNight } from '../night';

/** Where the night is, in seconds: kept up to date (about 12 times a second) while it plays. */
export function useNightTime(): number {
  const night = useNight();
  useSyncExternalStore(
    (fn) => night.subscribe(fn),
    () => night.version,
  );
  const [, tick] = useState(0);
  const playing = night.playing;
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => tick((n) => n + 1), 80);
    return () => window.clearInterval(id);
  }, [playing]);
  return night.position();
}

/** The row playing at night time `t`: during a blend the incoming track; in a gap, the next one. */
export function itemIndexAt(items: TimelineItem[], t: number): number {
  if (!items.length) return -1;
  let best = -1;
  items.forEach((it, i) => {
    if (t >= it.startsAt && t < it.startsAt + it.playFor && (best < 0 || it.startsAt >= items[best].startsAt)) best = i;
  });
  if (best >= 0) return best;
  const next = items.findIndex((it) => it.startsAt > t);
  return next >= 0 ? next : items.length - 1;
}

/** The moment in the song (seconds into the file) playing at night time `t`. */
export function songPos(it: TimelineItem, t: number): number {
  return itemMixIn(it) + Math.max(0, Math.min(it.playFor, t - it.startsAt)) * itemStretch(it);
}

/** Where in the song an item stops playing (file seconds). */
export function songEnd(it: TimelineItem): number {
  return itemMixIn(it) + it.playFor * itemStretch(it);
}

/** Night time at which moment `s` of the song plays. */
export function nightTimeOf(it: TimelineItem, s: number): number {
  return it.startsAt + (s - itemMixIn(it)) / itemStretch(it);
}

/** A night time as a wall-clock time ("11:30") when the set has a start time, else time into the set. */
export function clockLabel(t: number, startClock: string | undefined): string {
  if (parseClock(startClock) === undefined) return formatSetTime(t);
  const [h, m] = formatSetTime(t, startClock).split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}`;
}

/** mm:ss with leading zeros, as on the wireframes ("03:42"). */
export function mmss(sec: number | undefined): string {
  if (sec === undefined || !Number.isFinite(sec)) return '--:--';
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** The row playing now; re-renders only when it changes (not on every play, pause or seek). */
export function useNightIndex(items: TimelineItem[]): number {
  const night = useNight();
  const [idx, setIdx] = useState(() => itemIndexAt(items, night.position()));
  useEffect(() => {
    const check = () => setIdx(itemIndexAt(items, night.position()));
    check();
    const off = night.subscribe(check);
    const id = window.setInterval(() => night.playing && check(), 250);
    return () => {
      off();
      window.clearInterval(id);
    };
  }, [items, night]);
  return idx;
}

/** Time into the night to a tenth of a second: "03:42.5", "1:02:05.0" past an hour. */
export function nightTime(sec: number): string {
  const t = Math.max(0, Math.round(sec * 10) / 10);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = (t % 60).toFixed(1).padStart(4, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${String(m).padStart(2, '0')}:${s}`;
}
