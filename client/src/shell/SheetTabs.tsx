import type { SheetTabsProps } from './settings-tabs.ts';

/**
 * The tab row under a sheet bar, shared by the tool tabs (Ads) and the Settings tabs. A `nav` of plain buttons,
 * the current one marked `aria-current="page"`; not a `tablist`, so focus stays on the pressed tab. It reuses
 * the `.seg` look; `.tool-tabs` makes it size to its words and scroll sideways when narrow.
 */
export function SheetTabs({ label, items, current, onChoose, className = 'tool-tabs seg' }: SheetTabsProps) {
  return (
    <nav className={className} aria-label={label}>
      {items.map((t) => {
        const isCurrent = t.id === current;
        const count = t.count ?? 0;
        const note = count > 0 ? null : (t.note ?? null);
        const spoken =
          t.spoken ?? (count > 0 ? `${t.label}, ${count} waiting` : note ? `${t.label}, ${note}` : undefined);
        return (
          <button
            key={t.id}
            type="button"
            aria-current={isCurrent ? 'page' : undefined}
            aria-label={spoken}
            onClick={() => {
              if (!isCurrent) onChoose(t.id);
            }}
          >
            {t.label}
            {count > 0 ? <span className="count">{count}</span> : null}
            {note ? <span className="tool-tab-note">{note}</span> : null}
            {t.dot ? <span className="dot" data-state={t.dot} aria-hidden="true" /> : null}
          </button>
        );
      })}
    </nav>
  );
}
