import { useRef, useState } from 'react';

/**
 * Frame self-navigation guard for a sandboxed page frame. A page that navigates itself loads the
 * frame a second time; the caller then swaps the frame for a notice. Give each fresh frame a new
 * `frameId` (changing it, or the frame's `key`, starts the count again) and pass `onLoad` to the
 * iframe.
 */
export function useFrameGuard(frameId: string): { stopped: boolean; onLoad: () => void } {
  const [stoppedId, setStoppedId] = useState<string | null>(null);
  const loads = useRef<{ id: string; count: number }>({ id: '', count: 0 });
  const onLoad = () => {
    const l = loads.current;
    if (l.id !== frameId) loads.current = { id: frameId, count: 1 };
    else l.count += 1;
    if (loads.current.count > 1) setStoppedId(frameId);
  };
  return { stopped: stoppedId === frameId, onLoad };
}
