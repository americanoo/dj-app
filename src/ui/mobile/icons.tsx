/** The phone layout's icons, drawn as in the wireframes. Gradient strokes use ids unique to each icon. */
import { useId, type ReactNode } from 'react';

function Grad({ from, to, size = 26, view = 26, width = 1.7, children }: { from: string; to: string; size?: number; view?: number; width?: number; children: (stroke: string) => ReactNode }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox={`0 0 ${view} ${view}`} fill="none" stroke={`url(#${id})`} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      {children(`url(#${id})`)}
    </svg>
  );
}

// Main nav
export const LibraryIcon = () => (
  <Grad from="#7c3aed" to="#a855f7">
    {() => (
      <>
        <circle cx="13" cy="13" r="9.5" />
        <circle cx="13" cy="13" r="3" />
      </>
    )}
  </Grad>
);
export const PlaylistIcon = () => (
  <Grad from="#d6457f" to="#e8708f">
    {() => (
      <>
        <path d="M4 7.5h18M4 13h18M4 18.5h9" />
        <path d="M18 16.5l4.5 3-4.5 3z" />
      </>
    )}
  </Grad>
);
export const ToolsIcon = () => (
  <Grad from="#e1306c" to="#f04fa5">
    {() => (
      <>
        <path d="M7 4v18M13 4v18M19 4v18" />
        <circle cx="7" cy="16.5" r="2.2" fill="#0b0b0b" />
        <circle cx="13" cy="9" r="2.2" fill="#0b0b0b" />
        <circle cx="19" cy="14.5" r="2.2" fill="#0b0b0b" />
      </>
    )}
  </Grad>
);
export const SettingsIcon = () => (
  <Grad from="#2563eb" to="#3b82f6">
    {() => (
      <>
        <circle cx="13" cy="13" r="3.5" />
        <path d="M13 3v3.5M13 19.5V23M3 13h3.5M19.5 13H23M5.9 5.9l2.5 2.5M17.6 17.6l2.5 2.5M20.1 5.9l-2.5 2.5M8.4 17.6l-2.5 2.5" />
      </>
    )}
  </Grad>
);

// Tools (keyframe effects)
const tool = (from: string, to: string, body: ReactNode) => () => (
  <Grad from={from} to={to} size={22} view={24} width={1.6}>
    {() => body}
  </Grad>
);
export const EchoIcon = tool(
  '#7c3aed',
  '#a855f7',
  <>
    <circle cx="5" cy="12" r="1.6" />
    <path d="M9 8.5a5 5 0 0 1 0 7" />
    <path d="M13 5.5a9 9 0 0 1 0 13" />
    <path d="M17 3a13 13 0 0 1 0 18" />
  </>,
);
export const ReverbIcon = tool('#5b5bf0', '#8080ff', <path d="M2 12l2-8 2 16 2-13 2 10 2-7 2 4 2-2 2 1 4 -1" />);
export const FilterIcon = tool('#2563eb', '#3b82f6', <path d="M3 5h18l-7 8.5V19l-4-2v-3.5z" />);
export const KillLowsIcon = tool(
  '#d6457f',
  '#e8708f',
  <>
    <path d="M3.5 15.5l4 4M7.5 15.5l-4 4" />
    <path d="M12.5 20V9M19.5 20V4" />
  </>,
);
export const MicIcon = tool(
  '#e1306c',
  '#f04fa5',
  <>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </>,
);
export const KeyIcon = tool(
  '#c026d3',
  '#e879f9',
  <>
    <circle cx="7.5" cy="12" r="3.5" />
    <path d="M11 12h10M17.5 12v3M20.5 12v2.5" />
  </>,
);
export const SyncIcon = tool(
  '#7c3aed',
  '#a855f7',
  <>
    <path d="M4 10a8 8 0 0 1 14-3.5l2 2M20 4v4.5h-4.5" />
    <path d="M20 14a8 8 0 0 1-14 3.5l-2-2M4 20v-4.5h4.5" />
  </>,
);

// Plain icons (currentColor)
const plain = (body: ReactNode, size = 16, width = 1.75) => () => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
    {body}
  </svg>
);
export const DiamondIcon = plain(<path d="M12 3l8 9-8 9-8-9z" />);
export const FlagIcon = plain(<path d="M6 21V4M6 5h12l-3 4 3 4H6" />);
export const LoopIcon = plain(
  <>
    <path d="M4 10a8 8 0 0 1 14-3.5l2 2M20 4v4.5h-4.5" />
    <path d="M20 14a8 8 0 0 1-14 3.5l-2-2M4 20v-4.5h4.5" />
  </>,
);
export const LoopInIcon = plain(
  <>
    <path d="M7 4v16M7 4h4M7 20h4" />
    <path d="M13 12h8M18 9l3 3-3 3" />
  </>,
  20,
  1.6,
);
export const LoopOutIcon = plain(
  <>
    <path d="M17 4v16M17 4h-4M17 20h-4" />
    <path d="M3 12h8M8 9l3 3-3 3" />
  </>,
  20,
  1.6,
);
export const BackIcon = plain(<path d="M15 5l-7 7 7 7" />, 18, 1.8);
export const UndoIcon = plain(<path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />, 16, 1.6);
export const RedoIcon = plain(<path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" />, 16, 1.6);
export const SearchIcon = plain(
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </>,
  15,
  1.6,
);
export const DotsIcon = () => (
  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12">
    <circle cx="2" cy="6" r="1.2" fill="#c9cdd4" />
    <circle cx="6" cy="6" r="1.2" fill="#c9cdd4" />
    <circle cx="10" cy="6" r="1.2" fill="#c9cdd4" />
  </svg>
);
export const CheckIcon = () => (
  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12">
    <path d="M2 6.5l2.5 2.5L10 3" stroke="#f2f1ee" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);

export const PlusSmall = () => (
  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12">
    <path d="M6 1.5v9M1.5 6h9" stroke="#c9cdd4" strokeWidth="1.5" strokeLinecap="round" fill="none" />
  </svg>
);
export const PlusIcon = () => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14">
    <path d="M7 2v10M2 7h10" stroke="#c9cdd4" strokeWidth="1.75" strokeLinecap="round" fill="none" />
  </svg>
);
export const MixerIcon = () => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#c9cdd4" strokeWidth="1.5" strokeLinecap="round">
    <path d="M3.5 2v12M8 2v12M12.5 2v12" />
    <rect x="2" y="9" width="3" height="2.4" rx="0.6" fill="#0b0b0b" />
    <rect x="6.5" y="4.6" width="3" height="2.4" rx="0.6" fill="#0b0b0b" />
    <rect x="11" y="8" width="3" height="2.4" rx="0.6" fill="#0b0b0b" />
  </svg>
);
export const PlayBig = () => (
  <svg aria-hidden="true" width="30" height="30" viewBox="0 0 30 30" style={{ marginLeft: 4 }}>
    <path d="M7 3.5v23l19-11.5z" fill="#f2f1ee" />
  </svg>
);
export const PauseBig = () => (
  <svg aria-hidden="true" width="30" height="30" viewBox="0 0 30 30">
    <rect x="7" y="4" width="5.5" height="22" rx="1.2" fill="#f2f1ee" />
    <rect x="17.5" y="4" width="5.5" height="22" rx="1.2" fill="#f2f1ee" />
  </svg>
);
export const HandleIcon = () => (
  <svg aria-hidden="true" width="14" height="12" viewBox="0 0 14 12">
    <path d="M1 1.5h12M1 6h12M1 10.5h12" stroke="#8a8d96" strokeWidth="1.5" strokeLinecap="round" fill="none" />
  </svg>
);

/** Hot cue pad colours, by pad (the wireframes' palette). */
export const PAD_COLORS = ['#a855f7', '#e8708f', '#f04fa5', '#3b82f6', '#7c3aed', '#d6457f', '#c026d3', '#2563eb'];
