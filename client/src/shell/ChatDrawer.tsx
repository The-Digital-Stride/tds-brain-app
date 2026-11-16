import { useEffect, useRef, useState } from 'react';
import { ChatView } from '../components/Chat.tsx';
import { useStore } from '../store.tsx';
import { ResizeHandle } from './ResizeHandle.tsx';
import { useLayerWidth } from './useLayerWidth.ts';

/**
 * A tool's chat in a drawer on the right of the sheet (plan 2026-11-16-run-chat-drawer), so the tool stays in
 * view while Claude works. Non-modal: the tool behind stays usable. It is the active chat, so it is fully live.
 * Resizable, with its own saved width. Shows while `chatDrawer` is set (the store clears it when the chat or the
 * view changes); Hide, Esc and Open full screen close it.
 */
export function ChatDrawer() {
  const { chatDrawer } = useStore();
  if (chatDrawer == null) return null;
  return <ChatDrawerBody key={chatDrawer} />;
}

/** The sheet's width, kept up to date as the docks and the window change it. */
function useSheetWidth(): number | undefined {
  const [width, setWidth] = useState<number | undefined>(() => document.getElementById('main')?.clientWidth);
  useEffect(() => {
    const sheet = document.getElementById('main');
    if (!sheet || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(() => setWidth(sheet.clientWidth));
    watch.observe(sheet);
    return () => watch.disconnect();
  }, []);
  return width || undefined;
}

function ChatDrawerBody() {
  const layer = useLayerWidth('chat', useSheetWidth());
  // What had focus as the drawer opened (Run, Open chat): focus goes back there when it is hidden.
  const opener = useRef<Element | null>(typeof document === 'undefined' ? null : document.activeElement);
  useEffect(() => {
    const back = opener.current;
    return () => {
      // After the move: Open full screen's message box has taken focus by then, and is left alone.
      setTimeout(() => {
        const now = document.activeElement;
        if (now && now !== document.body) return;
        if (back instanceof HTMLElement && back.isConnected && back.closest('[inert]') === null) back.focus();
        else document.getElementById('main')?.focus({ preventScroll: true });
      }, 0);
    };
  }, []);
  return (
    <div className="chat-drawer glass" style={layer.style}>
      {layer.resizable ? <ResizeHandle layer={layer} label="Resize chat" /> : null}
      <ChatView placement="drawer" />
    </div>
  );
}
