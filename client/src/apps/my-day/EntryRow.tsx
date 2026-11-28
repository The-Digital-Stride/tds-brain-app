import type { DayEntryView, WorkItemOption } from '../../../../shared/time-contract.ts';
import { Icon } from '../../shell/Icon.tsx';
import { useStore } from '../../store.tsx';
import { Duration } from './Duration.tsx';
import {
  certaintyWords,
  chatTitleWords,
  DESCRIPTION_PLACEHOLDER,
  endClock,
  londonClock,
  openChatLabel,
  sourceWords,
} from './words.ts';

/** The work item's name for a row or a total; null when nothing is chosen. */
export function workItemName(id: string | null, items: readonly WorkItemOption[]): string | null {
  if (!id) return null;
  return items.find((i) => i.id === id)?.name ?? null;
}

/**
 * One entry of the day. The row's main button opens the edit panel; beside it (never inside it), an entry from
 * a chat Cortex still lists has a button that opens that chat in the drawer (plan decision A).
 */
export function EntryRow({
  entry,
  items,
  current,
  onOpen,
}: {
  entry: DayEntryView;
  items: readonly WorkItemOption[];
  current: boolean;
  onOpen: () => void;
}) {
  const { openPast } = useStore();
  const v = entry.values;
  const chatId = entry.chatId;
  const start = londonClock(v.startAt);
  const end = endClock(v.startAt, v.minutes);
  const name = workItemName(v.workItemId, items);
  const certainty = certaintyWords(entry.certainty);
  const description = v.description.trim();
  // The work item is named only once there is one; an empty slot is left to the day's "need attention" line.
  const itemWords = entry.workItemClosed
    ? 'Work item no longer listed'
    : (name ?? (v.workItemId ? 'Work item not loaded' : null));
  const meta = [itemWords, v.billable ? 'Billable' : 'Not billable', entry.evidence].filter(
    (m): m is string => m !== null && m !== '',
  );
  // "Unassigned" says what an empty work item already says; the source says what the evidence line says.
  const showCertainty = certainty !== null && !(entry.certainty === 'unassigned' && v.workItemId === null);
  return (
    <li
      className="line myday-row"
      data-current={current || undefined}
      aria-current={current ? 'true' : undefined}
    >
      <button
        type="button"
        className="myday-open"
        data-focus={`myday:${entry.id}`}
        aria-current={current ? 'true' : undefined}
        onClick={onOpen}
      >
        <span className="myday-time">
          {start && end ? `${start}–${end}` : 'No clock time'}
          <span className="myday-mins">
            <Duration minutes={v.minutes} />
          </span>
        </span>
        <span className="line-text">
          <span className="line-title">
            {description ? description : <span className="myday-placeholder">{DESCRIPTION_PLACEHOLDER}</span>}
          </span>
          {!description && entry.titleHint ? (
            <span className="myday-hint">{chatTitleWords(entry.titleHint)}</span>
          ) : null}
          <span className="line-meta">
            {meta.map((m, i) => (
              <span key={m}>
                {i > 0 ? (
                  <span className="todo-sep" aria-hidden="true">
                    {' · '}
                  </span>
                ) : null}
                {m}
              </span>
            ))}
          </span>
          <span className="myday-chips">
            {entry.evidence ? null : (
              <span className="chip">{sourceWords(entry.source, entry.fromToolbox)}</span>
            )}
            {showCertainty ? (
              entry.certainty === 'suggested' ? (
                <span className="badge" data-tone="warn">
                  {certainty}
                </span>
              ) : (
                <span className="chip">{certainty}</span>
              )
            ) : null}
            {entry.edited.length > 0 ? (
              <span className="badge" data-tone="muted">
                Edited
              </span>
            ) : null}
            {entry.missing ? (
              <span className="badge" data-tone="warn">
                No longer found
              </span>
            ) : null}
            {entry.workItemClosed ? (
              <span className="badge" data-tone="warn">
                Closed in Toolbox
              </span>
            ) : null}
          </span>
          {entry.problems.map((p) => (
            <span className="error myday-problem" key={p}>
              {p}
            </span>
          ))}
        </span>
      </button>
      {chatId ? (
        <button
          type="button"
          className="icon-btn myday-chat"
          aria-label={openChatLabel(entry.titleHint)}
          data-tip="Open the chat"
          onClick={() => void openPast(chatId, { in: 'drawer' })}
        >
          <Icon name="chat" size={16} />
        </button>
      ) : null}
    </li>
  );
}
