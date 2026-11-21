import { BRAND, BRAND_FORMER } from '../../../shared/brand.ts';

/** Bump to show the tour again to everyone who has finished or skipped an older one. */
export const TOUR_VERSION = 1;

/** The old-browser fallback when saving `prefs.tourSeen` fails. The key keeps the working name on purpose. */
export const TOUR_SEEN_KEY = 'tds-brain-tour-seen';

export interface TourStep {
  id: string;
  /** A selector for what to light up, or null for the centred welcome card. These are existing selectors. */
  anchor: string | null;
  title: string;
  text: string;
}

/** The first step, worded for someone who has used the app before, or for someone brand new. */
export function welcomeStep(existingUser: boolean): TourStep {
  return {
    id: 'welcome',
    anchor: null,
    title: `Welcome to ${BRAND}`,
    text: existingUser
      ? `${BRAND_FORMER} is now ${BRAND}. Nothing you rely on has moved: same chats, same to-dos, same settings. Here is a quick look round. It only takes a moment.`
      : `${BRAND} is where you work with Claude on TDS jobs. Here is a quick look round. It only takes a moment.`,
  };
}

/** The steps after the welcome, in order. */
export const TOUR_STEPS: TourStep[] = [
  {
    id: 'message',
    anchor: '.home-composer .composer-input',
    title: 'Ask for anything here',
    text: 'Type what you need, like you would ask a colleague. Claude can see your clients and how TDS does things.',
  },
  {
    id: 'client',
    anchor: '.home-composer #client-select',
    title: 'Who is it for?',
    text: 'Leave this on Auto and it works out the client from your message. Or pick one yourself.',
  },
  {
    id: 'chats',
    anchor: 'button.rail-item[data-dock-label="Chats"]',
    title: 'Your chats',
    text: 'Chats that are running and chats from before are kept here, so you can pick one up again.',
  },
  {
    id: 'todos',
    anchor: 'button.rail-item[data-dock-label="To-dos"]',
    title: 'Your to-dos',
    text: 'Yours and the team’s. Star the important ones and they show on Home.',
  },
  {
    id: 'search',
    anchor: '.sheet-bar button[aria-label="Search or jump to"]',
    title: 'Find anything fast',
    text: 'Press ⌘K (Ctrl K on Windows) and start typing. Chats, to-dos, skills, files and help all come up.',
  },
  {
    id: 'help',
    anchor: 'button.rail-item[data-dock-label="Help"]',
    title: 'Stuck? Open Help',
    text: 'Help opens on the page for the screen you are on. You can take this tour again from there.',
  },
];
