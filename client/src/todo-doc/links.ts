/** Decision 14: only http, https and mailto hrefs are shown as links. */
export function isSafeHref(href: string): boolean {
  return /^(?:https?:|mailto:)/i.test(href.trim());
}
