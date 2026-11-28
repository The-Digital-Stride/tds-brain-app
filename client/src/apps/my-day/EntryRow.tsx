import type { DayEntryView, WorkItemOption } from '../../../../shared/time-contract.ts';
import { certaintyWords, endClock, hoursWords, londonClock, sourceWords } from './words.ts';

/** The work item's name for a row or a total; null when nothing is chosen. */
export function workItemName(id: string | null, items: readonly WorkItemOption[]): string | null {
  if (!id) return null;
  return items.find((i) => i.id === id)?.name ?? null;
}

/** One entry of the day. The whole row opens the edit panel. */
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
  const v = entry.values;
  const start = londonClock(v.startAt);
  const end = endClock(v.startAt, v.minutes);
  const name = workItemName(v.workItemId, items);
  const certainty = certaintyWords(entry.certainty);
  return (
    <li className="line myday-row" data-current={current || undefined}>
      <button type="button" className="myday-open" data-focus={`myday:${entry.id}`} onClick={onOpen}>
        <span className="myday-time">
          {start && end ? `${start}–${end}` : 'No clock time'}
          <span className="myday-mins">{hoursWords(v.minutes)}</span>
        </span>
        <span className="line-text">
          <span className="line-title">{v.description.trim() || 'No description'}</span>
          <span className="line-meta">
            {entry.workItemClosed
              ? 'Work item no longer listed'
              : (name ?? (v.workItemId ? 'Work item not loaded' : 'No work item'))}
            {' · '}
            {v.billable ? 'Billable' : 'Not billable'}
            {entry.evidence ? ` · ${entry.evidence}` : ''}
          </span>
          <span className="myday-chips">
            <span className="chip">{sourceWords(entry.source, entry.fromToolbox)}</span>
            {certainty ? <span className="chip">{certainty}</span> : null}
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
    </li>
  );
}
