import { type RefObject, useEffect } from 'react';
import { openableLink } from '../../../../shared/page-links.ts';

/**
 * Opens a page's links in a new tab (plan 2026-11-15-pages-hardening, decision 1). The link script the
 * server adds to a served page posts a `PageOpenLinkMessage` instead of moving the frame; this acts on
 * one only when it comes from this frame's own window, the frame has focus and the person has just
 * clicked or pressed a key (a click in a frame activates its parents too), and the address passes
 * `openableLink`. Anything else is ignored, so a page can't open the app's own addresses or open tabs
 * on its own. Other moves still meet the frame's policy and the stop notice.
 */
export function usePageLinks(frameRef: RefObject<HTMLIFrameElement | null>): void {
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const frame = frameRef.current;
      const source = frame?.contentWindow;
      if (!frame || !source || e.source !== source) return;
      if (document.activeElement !== frame) return;
      if (navigator.userActivation?.isActive !== true) return;
      const url = openableLink(e.data, window.location.origin);
      if (!url) return;
      window.open(url.href, '_blank', 'noopener,noreferrer');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frameRef]);
}
