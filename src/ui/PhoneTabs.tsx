import type { PhoneTab } from './phone';

const TABS: { id: PhoneTab; label: string; icon: string; hint: string }[] = [
  { id: 'night', label: 'Night', icon: '◐', hint: 'The journey of the night' },
  { id: 'mix', label: 'Mix', icon: '⇄', hint: 'The transition between two tracks' },
  { id: 'deck', label: 'Deck', icon: '◉', hint: 'One track: waveform, cues and loops' },
  { id: 'library', label: 'Library', icon: '≡', hint: 'Your tracks' },
];

/** The phone's bottom bar: one panel at a time. */
export function PhoneTabs({ tab, onTab }: { tab: PhoneTab; onTab: (t: PhoneTab) => void }) {
  return (
    <nav className="phone-tabs" aria-label="Panels">
      {TABS.map((t) => (
        <button
          key={t.id}
          className={tab === t.id ? 'on' : ''}
          aria-current={tab === t.id ? 'page' : undefined}
          onClick={() => onTab(t.id)}
          title={t.hint}
        >
          <span className="phone-tab-icon" aria-hidden>
            {t.icon}
          </span>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
