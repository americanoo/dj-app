import { useLayoutEffect, useRef } from 'react';

/**
 * Keeps an element fully visible inside its parent by scaling it down.
 *
 * The element is given the parent's height. Parts of it that can stretch (the
 * waveform, list slots) shrink first; when the rest still doesn't fit, the
 * whole element is scaled down with CSS `zoom`, which also lets it re-flow at
 * full width. Below `minZoom` it stops shrinking and the parent scrolls
 * instead, so text never becomes unreadably small.
 */
export function useFitZoom<T extends HTMLElement>(minZoom = 0.5, enabled = true) {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent || !enabled) return;
    let raf = 0;

    const fit = () => {
      raf = 0;
      const cs = getComputedStyle(parent);
      const avail = parent.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      if (avail <= 0) return;
      // Start from full size every time, so growing the panel scales back up.
      let z = 1;
      el.style.zoom = '1';
      el.style.height = `${avail}px`;
      for (let i = 0; i < 4 && el.scrollHeight > el.clientHeight + 1; i++) {
        z = Math.max(minZoom, z * (el.clientHeight / el.scrollHeight));
        el.style.zoom = String(z);
        el.style.height = `${avail / z}px`;
        if (z === minZoom) break;
      }
      const overflow = el.scrollHeight > el.clientHeight + 1;
      // Last resort (a tiny panel): let it scroll rather than shrink further.
      if (overflow) el.style.height = '';
      parent.style.overflowY = overflow ? 'auto' : 'hidden';
      el.dataset.zoom = z.toFixed(3);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(fit);
    };

    fit();
    // Refit when the panel is resized or anything inside changes size.
    const ro = new ResizeObserver(schedule);
    ro.observe(parent);
    // Content appearing or disappearing (a cue form opening, a hint line). Not
    // style changes: fitting sets styles itself.
    const mo = new MutationObserver(schedule);
    mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    // …and sections changing size on their own (text re-wrapping, fonts loading).
    for (const child of Array.from(el.children)) ro.observe(child);

    return () => {
      ro.disconnect();
      mo.disconnect();
      cancelAnimationFrame(raf);
      el.style.zoom = '';
      el.style.height = '';
      parent.style.overflowY = '';
    };
  }, [minZoom, enabled]);

  return ref;
}

/** How much an element is scaled by `zoom` on it or its ancestors (1 = not at all). */
export function zoomOf(el: HTMLElement): number {
  const w = el.offsetWidth;
  return w ? el.getBoundingClientRect().width / w : 1;
}
