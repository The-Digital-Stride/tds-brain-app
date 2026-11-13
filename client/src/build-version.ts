/**
 * The app version this page was built from. Vite writes it in at build time (`define` in
 * vite.config.ts, from package.json), so it stays the same until the page is reloaded, while the
 * server's `appVersion` changes as soon as an update restarts it. Only releases that bump the version
 * (feat, fix, perf, refactor commits) prompt a reload; a chore-only update does not.
 */
declare const __APP_VERSION__: string | undefined;

/** '' when the page was not built by Vite (tests, a hand-run dev build without the define). */
export const CLIENT_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';

/** What config.ts reports when it couldn't read package.json. */
const UNKNOWN = '0.0.0';

/** True when the server runs a different version from this page, so a reload would bring the page up to date. */
export function isOutdated(client: string, server: string | null | undefined): boolean {
  if (!client || !server || server === UNKNOWN) return false;
  return client !== server;
}
