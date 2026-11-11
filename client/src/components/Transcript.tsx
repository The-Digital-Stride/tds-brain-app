import { useEffect, useMemo, useRef } from 'react';
import type { SessionState } from '../../../shared/contract.ts';
import { Markdown } from '../markdown.tsx';
import { currentStep, toBlocks } from '../state/blocks.ts';
import type { ChatItem, ChildItem, ToolItem } from '../state/chat-reducer.ts';
import { PermissionCard, QuestionCard } from './Cards.tsx';

function statusWord(t: ToolItem): string {
  return t.status === 'running' ? 'working' : t.status === 'ok' ? 'done' : 'did not work';
}

function ToolLine({ tool }: { tool: ToolItem }) {
  return (
    <li>
      <span>{tool.label}</span>{' '}
      <span className="tool-status" data-status={tool.status}>
        ({statusWord(tool)})
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

function ActivityGroup({ tools, active, waiting }: { tools: ToolItem[]; active: boolean; waiting: boolean }) {
  const step = active ? currentStep(tools) : null;
  const total = countAll(tools);
  let summary = `What Claude did (${total} ${total === 1 ? 'step' : 'steps'})`;
  if (active && waiting) summary = 'Waiting for you';
  else if (step) summary = `Claude is working: ${step}`;
  return (
    <details className="activity" data-running={step !== null}>
      <summary>{summary}</summary>
      <ul className="activity-steps">
        {tools.map((t) => (
          <ToolLine key={t.id} tool={t} />
        ))}
      </ul>
    </details>
  );
}

function itemKey(item: ChatItem): string {
  return item.kind === 'permission' || item.kind === 'question'
    ? `${item.kind}-${item.requestId}`
    : `${item.kind}-${item.id}`;
}

function Row({ item, sessionId, note }: { item: ChatItem; sessionId: string; note: boolean }) {
  switch (item.kind) {
    case 'user':
      return <div className="msg-user">{item.text}</div>;
    case 'assistant':
      return (
        <div className="msg-assistant" data-note={note}>
          <Markdown text={item.text} />
        </div>
      );
    case 'permission':
      return <PermissionCard item={item} sessionId={sessionId} />;
    case 'question':
      return <QuestionCard item={item} sessionId={sessionId} />;
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
}: {
  items: ChatItem[];
  sessionId: string;
  sessionState: SessionState;
}) {
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
      className="transcript"
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      <div className="transcript-inner">
        {blocks.map((b, i) =>
          b.kind === 'tools' ? (
            <ActivityGroup
              key={`tools-${b.id}`}
              tools={b.tools}
              active={busy && i === lastTools}
              waiting={sessionState === 'waiting'}
            />
          ) : (
            <Row key={itemKey(b.item)} item={b.item} sessionId={sessionId} note={b.note} />
          ),
        )}
      </div>
    </div>
  );
}
