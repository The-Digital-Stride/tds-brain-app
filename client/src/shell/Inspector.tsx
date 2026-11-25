import { useEffect, useRef, useState } from 'react';
import type { ChatContextDetail } from '../../../shared/context-contract.ts';
import type { ChatKind } from '../../../shared/contract.ts';
import { api } from '../api.ts';
import { approvalsSentence } from '../approvals.ts';
import { tokenWords } from '../format.ts';
import { useStore } from '../store.tsx';
import { ChatFiles } from './ChatFiles.tsx';
import type { PanelTab } from './contract.ts';
import { Fold } from './Fold.tsx';
import { Seg } from './Seg.tsx';
import { useShell } from './ShellProvider.tsx';
import { placeName, STATE_WORDS, whenWords } from './words.ts';

/** The short value for Approvals, in the panel's Details and in Settings; the full sentence sits under it. */
export const APPROVALS_SHORT = 'Same as your terminal';

const TABS: { value: PanelTab; label: string }[] = [
  { value: 'files', label: 'Files' },
  { value: 'details', label: 'Details' },
];

/** What fills this chat: used against the window, the heaviest items, and the last summary. */
function ContextFold({ sessionId, readingAt }: { sessionId: string; readingAt: number | null }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ChatContextDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const openNow = useRef(open);
  openNow.current = open;
  const asking = useRef(false);
  // The reading the panel shows. The server's full read also sends it down the stream, so seeing it
  // there again is not news; asking again would only fetch the rough version within 30 s.
  const shownAt = useRef<number | null>(null);
  // Asked for when the fold opens, and again when a newer reading arrives while it is open.
  useEffect(() => {
    if (!open) {
      shownAt.current = null;
      return;
    }
    // An answer on its way is at least as new as a reading that arrives meanwhile.
    if (asking.current || (readingAt !== null && readingAt === shownAt.current)) return;
    asking.current = true;
    setFailed(false);
    api
      .chatContext(sessionId)
      .then((d) => {
        if (!openNow.current) return;
        shownAt.current = d.reading?.at ?? null;
        setDetail(d);
      })
      .catch(() => {
        if (openNow.current) setFailed(true);
      })
      .finally(() => {
        asking.current = false;
      });
  }, [open, sessionId, readingAt]);

  const reading = detail?.reading ?? null;
  return (
    <Fold title="Context" defaultOpen={false} open={open} onToggle={setOpen}>
      {failed ? (
        <p className="kv-note">Couldn't read this chat's context just now.</p>
      ) : !detail ? (
        open ? (
          <p className="kv-note">Reading…</p>
        ) : null
      ) : !reading ? (
        <p className="kv-note">No reading yet. It appears once Claude has replied.</p>
      ) : (
        <div className="context-detail">
          <p>Chat {Math.max(0, reading.percent)}% full</p>
          <p className="kv-note">
            {reading.autoCompact
              ? `${tokenWords(reading.usedTokens)} of ${tokenWords(reading.limitTokens)} tokens before Claude summarises`
              : `${tokenWords(reading.usedTokens)} of ${tokenWords(reading.windowTokens)} tokens used. Auto-summarising is off.`}
          </p>
          <p className="kv-note">Most this model can hold: {tokenWords(reading.windowTokens)} tokens</p>
          {detail.approximate ? (
            <p className="kv-note">
              From Claude's last reply. Open this again in a minute for the full list.
            </p>
          ) : null}
          {detail.items.length > 0 ? (
            <ul className="context-items">
              {detail.items.map((item) => (
                <li className="context-item" key={`${item.group}-${item.name}`}>
                  <span>{item.name}</span>
                  <span className="context-tokens">{tokenWords(item.tokens)}</span>
                  {item.advice && !item.deferred ? (
                    <span className="context-advice">{item.advice}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {detail.lastCompaction ? (
            <p className="kv-note">
              Last summary:{' '}
              {detail.lastCompaction.preTokens !== null && detail.lastCompaction.postTokens !== null
                ? `${tokenWords(detail.lastCompaction.preTokens)} down to ${tokenWords(detail.lastCompaction.postTokens)} tokens`
                : 'sizes not known'}
            </p>
          ) : null}
        </div>
      )}
    </Fold>
  );
}

/**
 * The body of the right panel, "This chat": the chat's files and details. The right `Dock`
 * supplies the region, heading and close button. Nothing shows unless a live chat is on the sheet.
 */
export function Inspector() {
  const { boot, activeChat, chats, sessions, todos, setChatKind } = useStore();
  const { state, dispatch } = useShell();
  if (!boot || activeChat.kind !== 'live') return null;

  const id = activeChat.sessionId;
  const chat = chats[id];
  const live = sessions?.live.find((s) => s.id === id);
  const clientName = live?.client ? placeName(live.client, boot.clients) : 'No client';
  const todo = live?.todoId
    ? [...(todos?.mine ?? []), ...(todos?.open ?? [])].find((t) => t.key === live.todoId)
    : undefined;
  const started = live ? whenWords(live.startedAt) : '';
  const sessionState = chat?.sessionState ?? live?.state ?? null;
  const sdkId = chat?.sdkSessionId ?? live?.sdkSessionId ?? null;

  return (
    // The Show switch sits in the panel's fixed band, like a drawer's filters; only what it shows scrolls.
    <div className="drawer-split">
      <div className="drawer-tools">
        <Seg
          label="Show"
          value={state.panelTab}
          options={TABS}
          onChange={(tab) => dispatch({ type: 'set-panel-tab', tab })}
        />
      </div>
      <div className="drawer-scroll">
        <div className="inspector">
          {state.panelTab === 'files' ? (
            <ChatFiles sessionId={id} />
          ) : (
            <dl className="kv">
              <dt>Client</dt>
              <dd>{clientName}</dd>
              {live ? (
                <>
                  <dt>Kind</dt>
                  <dd>
                    <Seg<ChatKind>
                      label="Kind of chat"
                      value={live.kind ?? 'tds'}
                      options={[
                        { value: 'tds', label: 'TDS' },
                        { value: 'personal', label: 'Personal' },
                      ]}
                      onChange={(kind) => void setChatKind(id, kind)}
                    />
                    <span className="kv-note">
                      Only sorts your Chats list. The chat still uses the shared brain.
                    </span>
                  </dd>
                </>
              ) : null}
              {todo ? (
                <>
                  <dt>Task</dt>
                  <dd>{todo.title}</dd>
                </>
              ) : null}
              {started ? (
                <>
                  <dt>Started</dt>
                  <dd>{started}</dd>
                </>
              ) : null}
              {sessionState ? (
                <>
                  <dt>State</dt>
                  <dd>{STATE_WORDS[sessionState]}</dd>
                </>
              ) : null}
              <dt>Approvals</dt>
              <dd>
                {APPROVALS_SHORT}
                <span className="kv-note">{approvalsSentence(boot.engine.permissionMode)}</span>
              </dd>
              {sdkId ? (
                <>
                  <dt className="kv-wide">Continue in the terminal</dt>
                  <dd className="kv-wide">
                    <code className="terminal-cmd">claude --resume {sdkId}</code>
                    <span className="kv-note">
                      Chats started here do not show in the terminal's own list, so use this line.
                    </span>
                  </dd>
                </>
              ) : null}
            </dl>
          )}
          {state.panelTab === 'details' ? (
            <ContextFold key={id} sessionId={id} readingAt={chat?.context?.at ?? null} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
