import { createContext, memo, useContext, useEffect, useMemo, useRef } from 'react';
import {
  chatFileFor,
  findPathMentions,
  indexChatFiles,
  normaliseBrainPath,
  replyFolders,
} from '../../../shared/chat-files.ts';
import type { ChatFile, SessionState } from '../../../shared/contract.ts';
import { Markdown } from '../markdown.tsx';
import { Icon } from '../shell/Icon.tsx';
import { type ActivityEntry, currentStep, toBlocks } from '../state/blocks.ts';
import type { ChatItem, ChildItem, ToolItem } from '../state/chat-reducer.ts';
import { STEP_WORDS } from '../state/steps.ts';
import { SentFiles } from './Attachments.tsx';
import { PermissionCard, QuestionCard } from './Cards.tsx';

/** What the transcript needs to turn file names and steps into links (plan 2026-11-13-chat-files). */
interface FileLinks {
  /** `folders`: the folders the reply itself names (`replyFolders`), where its short names may be. */
  link: (raw: string, folders: readonly string[]) => string | null;
  brainRoot: string;
  byToolUse: ReadonlyMap<string, string>;
  onFile: (key: string) => void;
}
const FileLinksContext = createContext<FileLinks | null>(null);

/**
 * A reply. The linker is rebuilt whenever the chat's files change, and newly reported files must
 * still link older replies, so each reply works out which keys its own paths resolve to and only
 * renders again when that signature (or its text) changes.
 */
const AssistantText = memo(function AssistantText({ text }: { text: string }) {
  const links = useContext(FileLinksContext);
  const mentions = useMemo(() => findPathMentions(text), [text]);
  // A short name in this reply (`audit.md`) links only into a folder this same reply names.
  const brainRoot = links?.brainRoot ?? '';
  const folders = useMemo(
    () => replyFolders(mentions.map((m) => normaliseBrainPath(m, brainRoot))),
    [mentions, brainRoot],
  );
  const signature = links ? mentions.map((m) => links.link(m, folders) ?? '').join('|') : '';
  const latest = useRef(links);
  latest.current = links;
  // biome-ignore lint/correctness/useExhaustiveDependencies: stable for a signature; reads the latest linker.
  const link = useMemo(
    () => (links ? (raw: string) => latest.current?.link(raw, folders) ?? null : undefined),
    [signature, links === null, folders],
  );
  return <Markdown text={text} link={link} onFile={links?.onFile} />;
});

function ToolLine({ tool }: { tool: ToolItem }) {
  const links = useContext(FileLinksContext);
  const key = links?.byToolUse.get(tool.id);
  return (
    <li>
      {key !== undefined && links ? (
        <button type="button" className="link-btn" onClick={() => links.onFile(key)}>
          {tool.label}
        </button>
      ) : (
        <span>{tool.label}</span>
      )}{' '}
      <span className="tool-status" data-status={tool.status}>
        ({STEP_WORDS[tool.status]})
      </span>
      <HelperWork items={tool.children} />
    </li>
  );
}

/** What a helper agent did under a tool. Never shown as a reply. */
function HelperWork({ items }: { items: ChildItem[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      {items.map((c) =>
        c.kind === 'assistant' ? (
          <div className="helper-text" key={`a-${c.id}`}>
            <Markdown text={c.text} />
          </div>
        ) : (
          <ul key={`t-${c.id}`}>
            <ToolLine tool={c} />
          </ul>
        ),
      )}
    </div>
  );
}

function countAll(tools: ToolItem[]): number {
  return tools.reduce(
    (n, t) => n + 1 + countAll(t.children.filter((c): c is ToolItem => c.kind === 'tool')),
    0,
  );
}

function ActivityGroup({
  entries,
  tools,
  active,
  waiting,
}: {
  entries: ActivityEntry[];
  tools: ToolItem[];
  active: boolean;
  waiting: boolean;
}) {
  const step = active ? currentStep(tools) : null;
  const total = countAll(tools);
  let summary = `What Claude did (${total} ${total === 1 ? 'step' : 'steps'})`;
  if (active && waiting) summary = 'Waiting for you';
  else if (step) summary = `Claude is working: ${step}`;
  return (
    <details className="activity" data-running={step !== null}>
      <summary>
        <Icon name="chevron" size={14} />
        {summary}
      </summary>
      <ul className="activity-steps">
        {entries.map((e) =>
          e.kind === 'tool' ? (
            <ToolLine key={e.id} tool={e} />
          ) : (
            // A note Claude wrote between steps: folded in here, so the thread keeps just the answer.
            <li key={e.id} className="activity-note">
              <AssistantText text={e.text} />
            </li>
          ),
        )}
      </ul>
    </details>
  );
}

function itemKey(item: ChatItem): string {
  return item.kind === 'permission' || item.kind === 'question'
    ? `${item.kind}-${item.requestId}`
    : `${item.kind}-${item.id}`;
}

function Row({ item, sessionId }: { item: ChatItem; sessionId: string }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="msg-user">
          {item.text ? <span>{item.text}</span> : null}
          {item.attachments?.length ? <SentFiles files={item.attachments} /> : null}
        </div>
      );
    case 'assistant':
      return (
        <div className="msg-assistant">
          <AssistantText text={item.text} />
        </div>
      );
    // A card still waiting on the person shows in the floater above the message box, not here.
    // Once answered it shows here, as the record.
    case 'permission':
      return item.outcome === null ? null : <PermissionCard item={item} sessionId={sessionId} />;
    case 'question':
      return item.outcome === null ? null : <QuestionCard item={item} sessionId={sessionId} />;
    case 'notice':
      return (
        <div className="notice" data-level={item.level} role={item.level === 'error' ? 'alert' : undefined}>
          {item.text}
        </div>
      );
    case 'turn-end':
      if (item.interrupted) return <p className="record">You stopped Claude.</p>;
      if (!item.ok)
        return (
          <div className="notice" data-level="error" role="alert">
            Claude could not finish that.{item.errorText ? ` ${item.errorText}` : ''}
          </div>
        );
      return null;
    case 'tool':
      return null;
  }
}

export function Transcript({
  items,
  sessionId,
  sessionState,
  files,
  brainRoot = '',
  onFile,
}: {
  items: ChatItem[];
  sessionId: string;
  sessionState: SessionState;
  /** The chat's files, for links in replies and steps. Without them nothing is linked. */
  files?: readonly ChatFile[];
  brainRoot?: string;
  onFile?: (key: string) => void;
}) {
  const fileLinks = useMemo<FileLinks | null>(() => {
    if (!files || !onFile) return null;
    const index = indexChatFiles(files);
    return {
      link: (raw, folders) => chatFileFor(index, raw, brainRoot ?? '', folders),
      brainRoot: brainRoot ?? '',
      byToolUse: index.byToolUse,
      onFile,
    };
  }, [files, brainRoot, onFile]);
  const blocks = useMemo(() => toBlocks(items), [items]);
  const lastTools = blocks.map((b) => b.kind).lastIndexOf('tools');
  const busy = sessionState === 'working' || sessionState === 'starting' || sessionState === 'waiting';
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });

  return (
    <div
      className="thread"
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      <FileLinksContext.Provider value={fileLinks}>
        <div className="thread-col">
          {blocks.map((b, i) =>
            b.kind === 'tools' ? (
              <ActivityGroup
                key={`tools-${b.id}`}
                entries={b.entries}
                tools={b.tools}
                active={busy && i === lastTools}
                waiting={sessionState === 'waiting'}
              />
            ) : (
              <Row key={itemKey(b.item)} item={b.item} sessionId={sessionId} />
            ),
          )}
        </div>
      </FileLinksContext.Provider>
    </div>
  );
}
