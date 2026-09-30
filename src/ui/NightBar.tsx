import { useEffect, useRef } from 'react';
import { slotsAt } from '../core/setplan';
import { formatTime } from '../core/time';
import { useNight, useNightState } from './night';
import { useStore } from './store';

/** Which player the bar drives: the deck (one track, for cues) or the whole night. */
export function SourceSwitch() {
  const night = useNight();
  const { active } = useNightState();
  return (
    <div className="source-switch" role="group" aria-label="Player">
      <button
        className={active ? '' : 'on'}
        onClick={() => night.release()}
        title="Play the loaded track on the deck (cues, loops, FX)"
      >
        Deck
      </button>
      <button
        className={active ? 'on' : ''}
        onClick={() => night.focus()}
        disabled={!night.plan.length}
        title="Play the journey of the night as planned: overlapping tracks play together"
      >
        Night
      </button>
    </div>
  );
}

/** What's playing in the night right now, and where. Updated every frame, outside React. */
export function NightNow() {
  const night = useNight();
  const { playing } = useNightState();
  const { project } = useStore();
  const tracks = project.library.tracks;
  const titleEl = useRef<HTMLElement>(null);
  const clockEl = useRef<HTMLSpanElement>(null);
  const live = useRef(tracks);
  live.current = tracks;
  useEffect(() => {
    let raf = 0;
    let shownIds = '';
    const draw = () => {
      const t = night.position();
      const now = slotsAt([...night.plan], t);
      const ids = now.map((s) => s.trackId).join('|');
      if (ids !== shownIds && titleEl.current) {
        shownIds = ids;
        titleEl.current.textContent = now.length
          ? now.map((s) => live.current[s.trackId]?.title ?? '?').join('  ⇄  ')
          : 'Journey of the night';
      }
      if (clockEl.current) clockEl.current.textContent = formatTime(t);
      if (night.playing) raf = requestAnimationFrame(draw);
    };
    draw();
    const off = night.subscribe(() => {
      cancelAnimationFrame(raf);
      draw();
    });
    return () => {
      off();
      cancelAnimationFrame(raf);
    };
  }, [night, playing]);
  return (
    <>
      <div className="tb-track">
        <b ref={titleEl}>Journey of the night</b>
        <span>The night as planned · overlaps play together</span>
      </div>
      <span className="clock" ref={clockEl} />
    </>
  );
}
