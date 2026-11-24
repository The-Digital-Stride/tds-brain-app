/**
 * What had focus when a page outside the To-dos drawer opened its add form (a project's Add a to-do), so closing the
 * form puts focus back there rather than on the drawer's own Add. Set by ShellProvider's `dispatch` on every
 * `open-todo` (null unless it carries a `start`); taken by the drawer when the panel closes. One app, one opener.
 */
export const todoOpener: { current: HTMLElement | null } = { current: null };
