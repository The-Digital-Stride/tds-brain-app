import { BRAND } from '../../../shared/brand.ts';

/**
 * Bump to show the tour again to everyone who has finished or skipped an older one. Changing which steps
 * `TOUR_STEPS` has means a bump and a new `TOUR_HISTORY` line (steps.test.ts fails until both are done).
 */
export const TOUR_VERSION = 5;

/**
 * The step ids each tour version walked through, newest last. steps.test.ts checks the current version's line
 * matches `TOUR_STEPS`, so a new step can't ship without everyone being shown the new tour once.
 * 1: the TDS Cortex launch. 2: Projects, Working on, Images and Documents, the Workbench and Home's cards.
 * 3: the cards step now points at Customise Home. 4: the cards step names the Recent cards. 5: the task-updates step.
 */
export const TOUR_HISTORY: Record<number, string> = {
  1: 'message,client,chats,todos,search,help',
  2: 'message,working-on,client,projects,chats,todos,workbench,library,cards,search,help',
  3: 'message,working-on,client,projects,chats,todos,workbench,library,cards,search,help',
  4: 'message,working-on,client,projects,chats,todos,workbench,library,cards,search,help',
  5: 'message,working-on,client,projects,chats,todos,task-updates,workbench,library,cards,search,help',
};

/**
 * Places on the rail the tour leaves out on purpose, and why. Every other app (`APPS`), section (`SECTIONS`)
 * and drawer (`DRAWER_LABELS`) must be named in some step's `covers`; steps.test.ts fails otherwise, so a new
 * app or rail section can't ship without a tour step. Keys: `app:<id>`, `section:<id>`, `drawer:<name>`.
 */
export const NOT_TOURED: Record<string, string> = {
  'drawer:skills': 'Owners and scouts only; Help covers it.',
  // 'section' is the drawer every rail section opens in; each section is covered by its own key.
  'drawer:section': 'Each section is checked by its own section: key.',
};

/** The old-browser fallback when saving `prefs.tourSeen` fails. The key keeps the working name on purpose. */
export const TOUR_SEEN_KEY = 'tds-brain-tour-seen';

export interface TourStep {
  id: string;
  /**
   * A selector for what to light up, or null for the centred welcome card. A step whose anchor isn't on
   * screen (not this person's role, or nothing to show yet) is skipped.
   */
  anchor: string | null;
  title: string;
  text: string;
  /** The rail places this step introduces (`app:<id>`, `section:<id>`, `drawer:<name>`); see `NOT_TOURED`. */
  covers?: string[];
}

/** The first step, worded for someone who has used the app before, or for someone brand new. */
export function welcomeStep(existingUser: boolean): TourStep {
  return {
    id: 'welcome',
    anchor: null,
    title: `Welcome to ${BRAND}`,
    text: existingUser
      ? `${BRAND} has grown since you last looked round, with Projects and Working on among the new parts. Here is a quick tour. It only takes a moment.`
      : `${BRAND} is where you work with Claude on TDS jobs. Here is a quick look round. It only takes a moment.`,
  };
}

/**
 * The steps after the welcome, in order. `working-on` shows once the brain has projects, and `workbench` only
 * to people who can see one of its tools; the tour skips them otherwise.
 */
export const TOUR_STEPS: TourStep[] = [
  {
    id: 'message',
    anchor: '.home-composer .composer-input',
    title: 'Ask for anything here',
    text: 'Type what you need, like you would ask a colleague. Claude can see your clients and how TDS does things.',
  },
  {
    id: 'working-on',
    anchor: '.home-composer #pick-project',
    title: 'What are you working on?',
    text: 'Pick a project to see only its tasks and files, here and in Images and Documents. New chats start on its client.',
  },
  {
    id: 'client',
    anchor: '.home-composer #client-select',
    title: 'Who is it for?',
    text: 'Leave this on Auto and it works out the client from your message. Or pick one yourself.',
  },
  {
    id: 'projects',
    anchor: 'button.rail-item[data-app="projects"]',
    title: 'Your projects',
    text: 'One place for each piece of client work: its tasks, files, meetings, emails and an updates log. Save a chat there to share what you did.',
    covers: ['app:projects'],
  },
  {
    id: 'chats',
    anchor: 'button.rail-item[data-dock-label="Chats"]',
    title: 'Your chats',
    text: 'Chats that are running and chats from before are kept here, so you can pick one up again.',
    covers: ['drawer:chats'],
  },
  {
    id: 'todos',
    anchor: 'button.rail-item[data-dock-label="Tasks"]',
    title: 'Your tasks',
    text: 'Yours and the team’s. Star the important ones and they show on Home.',
    covers: ['drawer:todos'],
  },
  {
    id: 'task-updates',
    anchor: 'button.rail-item[data-dock-label="Tasks"]',
    title: 'Task updates',
    text: 'When a teammate updates, finishes or hands back a task of yours, the number on Tasks goes up and the Task updates card on Home lists it.',
  },
  {
    id: 'workbench',
    anchor: 'button.rail-item[data-dock-label="Workbench"]',
    title: 'The Workbench',
    text: 'Your working tools live here. For now, that’s the Ads tools for Google Ads decisions, jobs and reports.',
    covers: ['section:workbench'],
  },
  {
    id: 'library',
    anchor: '.rail .rail-group',
    title: 'Images and Documents',
    text: 'The Brain’s pictures and documents, by client. Open one to see it, or find it with search.',
    covers: ['app:images', 'app:documents'],
  },
  {
    id: 'cards',
    anchor: '.sheet-bar button[aria-label="Customise Home"]',
    title: 'Make Home yours',
    text: 'Home’s Recent cards show your newest tasks, chats, documents, images and projects. Customise Home lets you hide cards you don’t use and add shortcuts for the places, drawers and tools you use most. Drag a card by its grip to reorder.',
  },
  {
    id: 'search',
    anchor: '.sheet-bar button[aria-label="Search or jump to"]',
    title: 'Find anything fast',
    text: 'Press ⌘K (Ctrl K on Windows) and start typing. Chats, tasks, projects, files and help all come up.',
  },
  {
    id: 'help',
    anchor: 'button.rail-item[data-dock-label="Help"]',
    title: 'Stuck? Open Help',
    text: 'Help opens on the page for the screen you are on. You can take this tour again from there.',
    covers: ['drawer:help'],
  },
];
