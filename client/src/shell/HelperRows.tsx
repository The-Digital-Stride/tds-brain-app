import { useEffect, useState } from 'react';
import type { LiveHelper, LiveSession } from '../../../shared/contract.ts';
import { helperMeta } from '../format.ts';
import { useStore } from '../store.tsx';
import { Fold } from './Fold.tsx';
import { useShell } from './ShellProvider.tsx';

/** How many of a chat's helpers are working now (an older server sends none). */
export function helpersWorking(chat: Pick<LiveSession, 'helpers'>): number {
  return (chat.helpers ?? []).filter((h) => h.status === 'working').length;
}

/** "helper" or "helpers" with the number: "2 helpers". */
export function helperCount(n: number): string {
  return `${n} ${n === 1 ? 'helper' : 'helpers'}`;
}

function HelperRow({ chat, helper, now }: { chat: LiveSession; helper: LiveHelper; now: number }) {
  const { openChat } = useStore();
  const { dispatch, modes } = useShell();
  const title = helper.brief ? `${helper.name}: ${helper.brief}` : helper.name;
  return (
    <li className="line helper-line">
      <button
        type="button"
        className="line-main"
        onClick={() => {
          openChat(chat.id);
          if (modes.drawerOverlays) dispatch({ type: 'close-drawer' });
        }}
      >
        {/* Working shows the working dot; ended (failed too) is plain grey, like a chat that stopped on an error. */}
        <span
          className="dot"
          data-attention={helper.status === 'working' ? 'working' : undefined}
          aria-hidden="true"
        />
        <span className="line-text">
          <span className="line-title">{title}</span>
          <span className="line-meta">{helperMeta(helper, now)}</span>
        </span>
      </button>
    </li>
  );
}

/** A chat's helpers, as one nested list under its row. Nothing when it has none. */
export function HelperRows({ chat }: { chat: LiveSession }) {
  const helpers = chat.helpers ?? [];
  const working = helpers.some((h) => h.status === 'working');
  const [now, setNow] = useState(() => Date.now());
  // Open while any helper works, shut once all have ended; a click in between is kept until the next change.
  // Controlled rather than remounted, so keyboard focus stays put when the last helper ends.
  const [open, setOpen] = useState(working);
  useEffect(() => setOpen(working), [working]);
  useEffect(() => {
    if (!working) return;
    setNow(Date.now());
    // One timer for the whole list, only while a helper is working.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [working]);
  if (helpers.length === 0) return null;
  return (
    <li className="helpers">
      <Fold title="Helpers" count={helpers.length} open={open} onToggle={setOpen}>
        <ul className="drawer-list">
          {helpers.map((h) => (
            <HelperRow key={h.id} chat={chat} helper={h} now={now} />
          ))}
        </ul>
      </Fold>
    </li>
  );
}
