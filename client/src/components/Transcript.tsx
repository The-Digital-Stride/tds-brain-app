import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  chatFileFor,
  findPathMentions,
  indexChatFiles,
  normaliseBrainPath,
  replyFolders,
} from '../../../shared/chat-files.ts';
import type { ChatFile, SessionState } from '../../../shared/contract.ts';
import type { ChatPage } from '../../../shared/pages-contract.ts';
import { api } from '../api.ts';
import { Markdown } from '../markdown.tsx';
import { Icon } from '../shell/Icon.tsx';
import { type ActivityEntry, currentStep, toBlocks } from '../state/blocks.ts';
import type { ChatItem, ChildItem, ToolItem } from '../state/chat-reducer.ts';
import { reportTitle, STEP_WORDS } from '../state/steps.ts';
import { useStore } from '../store.tsx';
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
/** Marks a page's key where a file's key is expected: the reply link carries it back to `onFile`. */
const PAGE_KEY_PREFIX = 'artifact-page:';
// A claude.ai address in reply text, as far as the first character that can't be part of one.
const CLAUDE_ADDRESS = /https:\/\/claude\.ai\/[^\s)\]>"'`<]+/g;
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
  // Addresses are part of the signature too: a page can arrive after the reply that names it.
  const addresses = useMemo(() => text.match(CLAUDE_ADDRESS) ?? [], [text]);
  const signature = links
    ? [...mentions, ...addresses].map((m) => links.link(m, folders) ?? '').join('|')
    : '';
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
  const reports = entries.filter((e) => e.kind === 'report').length;
  const counts = [
    total > 0 ? `${total} ${total === 1 ? 'step' : 'steps'}` : '',
    reports > 0 ? `${reports} ${reports === 1 ? 'helper report' : 'helper reports'}` : '',
  ].filter(Boolean);
  let summary = counts.length > 0 ? `What Claude did (${counts.join(', ')})` : 'What Claude did';
  if (active && waiting) summary = 'Waiting for you';
  else if (step) summary = `Claude is working: ${step}`;
  return (
    <details className="activity step-fold" data-running={step !== null}>
      <summary>
        <Icon name="chevron" size={14} />
        {summary}
      </summary>
      <ul className="activity-steps">
        {entries.map((e) =>
          e.kind === 'tool' ? (
            <ToolLine key={e.id} tool={e} />
          ) : e.kind === 'report' ? (
            // A helper's report: long, so it opens on its own, inside the fold.
            <li key={e.id} className="activity-report">
              <details>
                <summary>
                  <Icon name="chevron" size={14} />
                  {reportTitle(e.name)}
                </summary>
                <div className="activity-report-body">
                  <AssistantText text={e.text} />
                </div>
              </details>
            </li>
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

/**
 * A message a hook in Claude Code held back (the cache-tax mod does this once when a chat's cache has gone cold).
 * Send again sends exactly what went the first time, files included, so nothing has to be pasted again.
 */
function HeldNotice({ text, sessionId, canResend }: { text: string; sessionId: string; canResend: boolean }) {
  const { run } = useStore();
  const [busy, setBusy] = useState(false);
  return (
    <div className="notice" data-shape="box" data-level="warn">
      <span>{text}</span>
      {canResend ? (
        <button
          type="button"
          className="btn"
          data-size="small"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            // On success the chat starts working and the button goes; on failure the error shows and it stays.
            await run(() => api.resend(sessionId));
            setBusy(false);
          }}
        >
          Send again
        </button>
      ) : null}
    </div>
  );
}

function Row({ item, sessionId, resendId }: { item: ChatItem; sessionId: string; resendId?: string | null }) {
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
      if (item.resend)
        return <HeldNotice text={item.text} sessionId={sessionId} canResend={item.id === resendId} />;
      return (
        <div
          className="notice"
          data-shape="box"
          data-level={item.level === 'warning' ? 'warn' : item.level}
          role={item.level === 'error' ? 'alert' : undefined}
        >
          {item.text}
        </div>
      );
    case 'summary':
      return (
        <div className="notice" data-shape="box" data-kind="summary">
          {item.text}
        </div>
      );
    case 'turn-end':
      if (item.interrupted) return <p className="record">You stopped Claude.</p>;
      if (!item.ok)
        return (
          <div className="notice" data-shape="box" data-level="error" role="alert">
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
  pages,
  brainRoot = '',
  onFile,
  onPage,
}: {
  items: ChatItem[];
  sessionId: string;
  sessionState: SessionState;
  /** The chat's files, for links in replies and steps. Without them nothing is linked. */
  files?: readonly ChatFile[];
  /** The chat's pages (Artifact publishes): a known claude.ai address, or its step, opens one in the viewer. */
  pages?: readonly ChatPage[];
  brainRoot?: string;
  onFile?: (key: string) => void;
  /** Opens a page (its `key`) in the viewer. Without it, pages are not linked. */
  onPage?: (key: string) => void;
}) {
  const fileLinks = useMemo<FileLinks | null>(() => {
    if (!files || !onFile) return null;
    const index = indexChatFiles(files);
    const known = onPage ? (pages ?? []) : [];
    const byUrl = new Map(known.flatMap((p) => (p.url ? [[p.url.replace(/\/$/, ''), p.key] as const] : [])));
    const byToolUse = new Map(index.byToolUse);
    for (const p of known) for (const id of p.toolUseIds) byToolUse.set(id, `${PAGE_KEY_PREFIX}${p.key}`);
    return {
      link: (raw, folders) => {
        const page = byUrl.get(raw.replace(/\/$/, ''));
        return page !== undefined
          ? `${PAGE_KEY_PREFIX}${page}`
          : chatFileFor(index, raw, brainRoot ?? '', folders);
      },
      brainRoot: brainRoot ?? '',
      byToolUse,
      onFile: (key) => {
        if (key.startsWith(PAGE_KEY_PREFIX)) onPage?.(key.slice(PAGE_KEY_PREFIX.length));
        else onFile(key);
      },
    };
  }, [files, pages, brainRoot, onFile, onPage]);
  const blocks = useMemo(() => toBlocks(items), [items]);
  // Send again only on the newest held message, while it is still the last thing said and Claude is free.
  const resendId = useMemo(() => {
    if (sessionState !== 'idle') return null;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it?.kind === 'notice' && it.resend) return it.id;
      if (it?.kind === 'user' || it?.kind === 'assistant') return null;
    }
    return null;
  }, [items, sessionState]);
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
              <Row key={itemKey(b.item)} item={b.item} sessionId={sessionId} resendId={resendId} />
            ),
          )}
        </div>
      </FileLinksContext.Provider>
    </div>
  );
}
