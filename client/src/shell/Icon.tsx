import type { ReactNode } from 'react';
import type { IconName, IconProps } from './contract.ts';

/** 20×20 line icons, drawn with the current text colour. */
const PATHS: Record<IconName, ReactNode> = {
  plus: <path d="M10 4v12M4 10h12" />,
  // Five points on a 20 grid. Outlined by default; a favourite's button fills it (drawers.css).
  star: <path className="icon-star" d="M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z" />,
  lock: (
    <>
      <rect x="4.5" y="9" width="11" height="8" rx="1.5" />
      <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="4.5" width="13" height="12" rx="1.5" />
      <path d="M3.5 8.5h13M7 3v3M13 3v3" />
    </>
  ),
  person: (
    <>
      <circle cx="10" cy="7" r="3" />
      <path d="M4 16.5c.8-3 3-4.5 6-4.5s5.2 1.5 6 4.5" />
    </>
  ),
  home: <path d="M3 9.5 10 3l7 6.5V16a1 1 0 0 1-1 1h-3.5v-5h-5v5H4a1 1 0 0 1-1-1z" />,
  edit: <path d="M13.5 3.5l3 3L7 16H4v-3zM11.5 5.5l3 3" />,
  more: <path d="M5 10h.01M10 10h.01M15 10h.01" strokeWidth={2.6} />,
  chat: <path d="M4 4h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9l-4 3v-3H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />,
  todos: <path d="M3 6l1.5 1.5L7 5M3 13l1.5 1.5L7 12M10 6h7M10 13h7" />,
  skills: <path d="M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z" />,
  settings: (
    <>
      <path d="M3 6h8M16 6h1M3 14h1M9 14h8" />
      <circle cx="13.5" cy="6" r="2" />
      <circle cx="6.5" cy="14" r="2" />
    </>
  ),
  rail: <path d="M3 4h14v12H3zM8 4v12" />,
  panel: <path d="M3 4h14v12H3zM12 4v12" />,
  bin: (
    <>
      <path d="M4 6h12M8 6V4h4v2M5.5 6l.7 10a1 1 0 0 0 1 .9h5.6a1 1 0 0 0 1-.9l.7-10M8.5 9v5M11.5 9v5" />
    </>
  ),
  close: <path d="M5 5l10 10M15 5L5 15" />,
  search: (
    <>
      <circle cx="9" cy="9" r="5" />
      <path d="M13 13l4 4" />
    </>
  ),
  chevron: <path d="M5 8l5 5 5-5" />,
  check: <path d="M4.5 10.5l3.5 3.5 7.5-8" />,
  go: <path d="M4 10h11M11 5l5 5-5 5" />,
  // Two chain links: a web address.
  link: (
    <path d="M8.33 10.83a4.17 4.17 0 0 0 6.28.45l2.5-2.5a4.17 4.17 0 0 0-5.89-5.89l-1.43 1.42M11.67 9.17a4.17 4.17 0 0 0-6.28-.45l-2.5 2.5a4.17 4.17 0 0 0 5.89 5.89l1.42-1.42" />
  ),
  image: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="1.5" />
      <circle cx="7.5" cy="8.5" r="1.5" />
      <path d="M3.5 14.5 8 11l3 2.5 2.5-2 3 3" />
    </>
  ),
  doc: (
    <path d="M5 3h7l3.5 3.5V16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM12 3v3.5h3.5M7 10h6M7 13h6" />
  ),
  sheet: <path d="M3 4h14v12H3zM3 8h14M3 12h14M8 4v12" />,
  slides: <path d="M3 4h14v9H3zM10 13v3M7 16.5h6M6.5 7.5h4M6.5 10h7" />,
  paperclip: (
    <path d="M16 9.5l-5.8 5.8a3.5 3.5 0 0 1-5-5l6-6a2.3 2.3 0 0 1 3.3 3.3l-6 6a1.1 1.1 0 0 1-1.6-1.6L12 6.6" />
  ),
  up: <path d="M5 12l5-5 5 5" />,
  // A capital H: a heading.
  heading: <path d="M5 4v12M15 4v12M5 10h10" />,
  // A plain line of text: body text.
  body: <path d="M3.5 6h13M3.5 10h13M3.5 14h8" />,
  bullets: <path d="M4.5 6h.01M4.5 10h.01M4.5 14h.01M8 6h9M8 10h9M8 14h9" strokeWidth={2} />,
  numbers: <path d="M3.5 4.8l1.2-.8v4.2M3.2 11.8h2.2l-2.2 2.8h2.3M8.5 6h8.5M8.5 13h8.5" />,
  bold: <path d="M6 4h4.5a2.8 2.8 0 0 1 0 5.6H6zM6 9.6h5.2a2.8 2.8 0 0 1 0 5.6H6z" />,
  // A circle with a question mark: Help.
  help: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M7.9 8.1a2.2 2.2 0 1 1 3.3 1.9c-.8.5-1.2 1-1.2 1.8M10 14h.01" />
    </>
  ),
  // A toolbox: a lid with a handle over a body split by a catch.
  workbench: (
    <>
      <rect x="3" y="7" width="14" height="9.5" rx="1.5" />
      <path d="M7.5 7V5.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7M3 11.5h14M10 10.5v2" />
    </>
  ),
  // A folder with a tab: Projects (each project is a folder in the brain).
  folder: (
    <path d="M3 6a1 1 0 0 1 1-1h3.8l1.7 2H16a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM3 9.5h14" />
  ),
  // A rising line over an axis: Ad Manager.
  chart: <path d="M3.5 4v12.5h13M6.5 13l3-3.5 2.5 2L16 6.5M13 6.5h3V9.5" />,
  inbox: <path d="M3.5 11l2-6.5h9l2 6.5v4.5h-13zM3.5 11h4l1 2h3l1-2h4" />,
  play: <path d="M6.5 4.5v11l9-5.5z" />,
  stop: <rect x="5" y="5" width="10" height="10" rx="1.5" />,
  // Six dots, two across and three down: a drag handle.
  grip: <path d="M7.5 5h.01M12.5 5h.01M7.5 10h.01M12.5 10h.01M7.5 15h.01M12.5 15h.01" strokeWidth={2.6} />,
  // Two arrows pointing apart: full width.
  wide: <path d="M3 10h14M6 7l-3 3 3 3M14 7l3 3-3 3" />,
  // A paper plane: Send's, paired with Stop's square.
  send: <path d="M17 3 3 8.5l5.5 2.5L11 17zM17 3l-8.5 8" />,
};

/** Decorative: always hidden from assistive tech. The control around it carries the name. */
export function Icon({ name, size = 20 }: IconProps) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
