import type { ReactNode } from 'react';
import type { IconName, IconProps } from './contract.ts';

/** 20×20 line icons, drawn with the current text colour. */
const PATHS: Record<IconName, ReactNode> = {
  home: <path d="M3 9.5 10 3l7 6.5V16a1 1 0 0 1-1 1h-3.5v-5h-5v5H4a1 1 0 0 1-1-1z" />,
  edit: <path d="M13.5 3.5l3 3L7 16H4v-3zM11.5 5.5l3 3" />,
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
  close: <path d="M5 5l10 10M15 5L5 15" />,
  search: (
    <>
      <circle cx="9" cy="9" r="5" />
      <path d="M13 13l4 4" />
    </>
  ),
  chevron: <path d="M5 8l5 5 5-5" />,
  go: <path d="M4 10h11M11 5l5 5-5 5" />,
  pin: <path d="M12 3l5 5M14.5 5.5 11 9l1 4-1 1-6-6 1-1 4 1 3.5-3.5M8 12l-5 5" />,
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
  stop: <rect x="5" y="5" width="10" height="10" rx="1.5" />,
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
