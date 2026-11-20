import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A quiet "more" button that opens a small menu of the less-used actions.
 * The menu stays mounted while closed (just hidden), so anything inside that
 * needs to outlive a click, like a file picker, keeps working.
 */
export function MenuButton({ label, title, children }: { label: ReactNode; title: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div className="menu" ref={root}>
      <button
        className={`icon menu-btn ${open ? 'on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
      </button>
      <div className="menu-pop" role="menu" hidden={!open}>
        {children(close)}
      </div>
    </div>
  );
}
