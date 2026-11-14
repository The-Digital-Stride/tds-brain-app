import { useMemo } from 'react';
import { indexChatFiles } from '../../../shared/chat-files.ts';
import { approvalsSentence } from '../approvals.ts';
import { Markdown } from '../markdown.tsx';
import type { ChatState } from '../state/chat-reducer.ts';
import { reportTitle, STEP_WORDS, stepsOf } from '../state/steps.ts';
import { useStore } from '../store.tsx';
import { ChatFiles } from './ChatFiles.tsx';
import type { PanelTab } from './contract.ts';
import { Seg } from './Seg.tsx';
import { useShell } from './ShellProvider.tsx';
import { placeName, STATE_WORDS, whenWords } from './words.ts';

/** The short value for Approvals, in the panel's Details and in Settings; the full sentence sits under it. */
export const APPROVALS_SHORT = 'Same as your terminal';

const TABS: { value: PanelTab; label: string }[] = [
  { value: 'steps', label: 'Steps' },
  { value: 'files', label: 'Files' },
  { value: 'details', label: 'Details' },
];

function Steps({ chat, sessionId }: { chat: ChatState | undefined; sessionId: string }) {
  const { dispatch } = useShell();
  const files = chat?.files.files;
  const byToolUse = useMemo(() => indexChatFiles(files ?? []).byToolUse, [files]);
  const entries = stepsOf(chat?.items ?? []);
  if (!entries.some((e) => e.kind === 'step')) return <p className="dock-empty">No steps yet.</p>;
  let n = 0;
  return (
    <ol className="steps">
      {entries.map((s) =>
        s.kind === 'note' ? (
          // What Claude said between steps, the same notes the thread folds into "What Claude did".
          <li key={s.id} className="step step-note">
            <span aria-hidden="true" />
            <div className="step-note-text">
              <span className="visually-hidden">Claude's note: </span>
              <Markdown text={s.text} />
            </div>
          </li>
        ) : s.kind === 'report' ? (
          // A helper's report came back here; its text is in the thread's "What Claude did".
          <li key={s.id} className="step step-note">
            <span aria-hidden="true" />
            <span className="step-text">
              <span className="step-label">{reportTitle(s.name)}</span>
            </span>
          </li>
        ) : (
          <li key={s.id} className="step" data-depth={Math.min(s.depth, 3)}>
            {/* Read out: screen readers count notes as list items, so the list position would not match. */}
            <span className="step-n">{++n}</span>
            <span className="step-text">
              {byToolUse.has(s.id) ? (
                <button
                  type="button"
                  className="step-label link-btn"
                  onClick={() =>
                    dispatch({ type: 'show-chat-file', chat: sessionId, key: byToolUse.get(s.id) ?? null })
                  }
                >
                  {s.label}
                </button>
              ) : (
                <span className="step-label">{s.label}</span>
              )}
              <span className="step-status" data-status={s.status}>
                {STEP_WORDS[s.status]}
              </span>
            </span>
          </li>
        ),
      )}
    </ol>
  );
}

/**
 * The body of the right panel, "This chat": the chat's steps, files and details. The right `Dock`
 * supplies the region, heading and close button. Nothing shows unless a live chat is on the sheet.
 */
export function Inspector() {
  const { boot, activeChat, chats, sessions, todos } = useStore();
  const { state, dispatch } = useShell();
  if (!boot || activeChat.kind !== 'live') return null;

  const id = activeChat.sessionId;
  const chat = chats[id];
  const live = sessions?.live.find((s) => s.id === id);
  const clientName = live?.client ? placeName(live.client, boot.clients) : 'No client';
  const todo = live?.todoId
    ? [...(todos?.mine ?? []), ...(todos?.open ?? [])].find((t) => t.id === live.todoId)
    : undefined;
  const started = live ? whenWords(live.startedAt) : '';
  const sessionState = chat?.sessionState ?? live?.state ?? null;
  const sdkId = chat?.sdkSessionId ?? live?.sdkSessionId ?? null;
  const canResume = boot.identity.role === 'owner' || boot.identity.role === 'scout';

  return (
    <div className="inspector">
      <Seg
        label="Show"
        value={state.panelTab}
        options={TABS}
        onChange={(tab) => dispatch({ type: 'set-panel-tab', tab })}
      />
      {state.panelTab === 'steps' ? (
        <Steps chat={chat} sessionId={id} />
      ) : state.panelTab === 'files' ? (
        <ChatFiles sessionId={id} />
      ) : (
        <dl className="kv">
          <dt>Client</dt>
          <dd>{clientName}</dd>
          {todo ? (
            <>
              <dt>To-do</dt>
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
          {sdkId && canResume ? (
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
    </div>
  );
}
