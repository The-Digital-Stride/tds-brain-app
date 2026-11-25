/**
 * The small Gmail compose window: beside the Cortex window, kept on the screen. Used by a project's "Write
 * an email" and by the email card in a chat (Gmail can't be shown inside another page).
 */
import type { MouseEvent } from 'react';

export const COMPOSE_WIDTH = 680;
export const COMPOSE_HEIGHT = 760;

/**
 * `window.open` features for the compose window: a small window at the right of the Cortex window, kept on
 * the screen, with no link back to this page (`noopener`, `noreferrer`: Gmail learns nothing about Cortex).
 */
export function composeWindowFeatures(win: {
  screenX: number;
  screenY: number;
  outerWidth: number;
  outerHeight: number;
}): string {
  const left = Math.max(0, Math.round(win.screenX + win.outerWidth - COMPOSE_WIDTH - 24));
  const top = Math.max(0, Math.round(win.screenY + Math.max(0, (win.outerHeight - COMPOSE_HEIGHT) / 2)));
  return `popup=yes,width=${COMPOSE_WIDTH},height=${COMPOSE_HEIGHT},left=${left},top=${top},noopener,noreferrer`;
}

/**
 * The click handler of a link to Gmail compose. A plain click opens the small window; a click that asks for
 * a tab or a new window (a modifier key, another mouse button) is left to the browser and the link's own
 * `href`.
 */
export function openGmailWindow(e: MouseEvent<HTMLAnchorElement>, url: string): void {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  window.open(url, '_blank', composeWindowFeatures(window));
}
