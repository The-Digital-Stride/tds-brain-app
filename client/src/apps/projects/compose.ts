/**
 * "Write an email" on a project's Overview: who it can go to, and the small Gmail window it opens in.
 * Pure helpers; the reading of contacts out of the client's files is the server's (business-contacts.ts).
 */
import type { BusinessContact } from '../../../../shared/project-business-contract.ts';

/** Mail hosts anyone can have an address at: sharing one says nothing about being a teammate. */
const PUBLIC_HOSTS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'hotmail.co.uk',
  'live.com',
  'live.co.uk',
  'yahoo.com',
  'yahoo.co.uk',
  'icloud.com',
  'me.com',
  'aol.com',
  'btinternet.com',
  'proton.me',
  'protonmail.com',
]);

const hostOf = (email: string): string => email.slice(email.lastIndexOf('@') + 1).toLowerCase();

/**
 * The contacts to offer: the client's people, never this person or their own colleagues. An address at the
 * same host as `ownEmail` is a teammate named in the client's file, so it is left out (unless that host is a
 * public mail host, where a shared host means nothing).
 */
export function composeContacts(
  contacts: readonly BusinessContact[] | undefined,
  ownEmail: string | null,
): BusinessContact[] {
  if (!contacts) return [];
  const own = ownEmail ? ownEmail.toLowerCase() : null;
  const ownHost = own ? hostOf(own) : null;
  return contacts.filter((c) => {
    const email = c.email.toLowerCase();
    if (own && email === own) return false;
    return !(ownHost && !PUBLIC_HOSTS.has(ownHost) && hostOf(email) === ownHost);
  });
}

/** One line of the picker: "Kim Example (kim@acme.co.uk)", or the address alone when the file gave no name. */
export const contactWords = (c: BusinessContact): string => (c.name ? `${c.name} (${c.email})` : c.email);

/** The picker's last line: Gmail opens with nobody filled in. */
export const SOMEONE_ELSE = 'Someone else';

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
