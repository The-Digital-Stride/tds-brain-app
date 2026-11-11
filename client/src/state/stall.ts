/** True when nothing (message, ping or open) has arrived on the stream for `stallMs`. */
export function isStalled(lastActivityAt: number, now: number, stallMs: number): boolean {
  return now - lastActivityAt >= stallMs;
}
