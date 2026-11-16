import { useId, useMemo, useState } from 'react';
import { useStore } from '../store.tsx';
import { Fold } from './Fold.tsx';
import { Icon } from './Icon.tsx';
import { useShell } from './ShellProvider.tsx';
import { SECTIONS, toolView, visibleTools } from './sections.ts';
import type { ToolSlot, ToolSnapshot } from './sections-contract.ts';

/** A search row appears only when the list is long enough to need one. */
export const SECTION_SEARCH_FROM = 8;

function ToolRow({
  tool,
  snap,
  current,
  onOpen,
}: {
  tool: ToolSlot;
  snap: ToolSnapshot;
  current: boolean;
  onOpen: () => void;
}) {
  const count = tool.badge?.(snap) ?? 0;
  return (
    <li>
      <button
        type="button"
        className="line section-row"
        aria-current={current ? 'page' : undefined}
        onClick={onOpen}
      >
        <Icon name={tool.icon} />
        <span className="line-text">
          <span className="line-title">{tool.title}</span>
          <span className="line-meta">{tool.summary}</span>
        </span>
        {count > 0 ? <span className="count">{count}</span> : null}
      </button>
    </li>
  );
}

/**
 * The section drawer: the tools of `ShellState.section`, as rows. Same anatomy as Help's drawer. Choosing a tool opens
 * it on the sheet (the store's `openTool`), and the shell then closes the drawer, as it does for an app.
 */
export function SectionDrawer() {
  const { state, dispatch } = useShell();
  const { ads, view, openTool } = useStore();
  const [query, setQuery] = useState('');
  const searchId = useId();
  const section = SECTIONS.find((s) => s.id === state.section);
  const snap = useMemo<ToolSnapshot>(() => ({ ads }), [ads]);
  if (!section) return null;

  const tools = visibleTools(section, snap);
  const q = query.trim().toLowerCase();
  const shown = q ? tools.filter((t) => `${t.title} ${t.summary}`.toLowerCase().includes(q)) : tools;
  const groupNames = [...new Set(tools.map((t) => t.group).filter((g): g is string => !!g))];
  const grouped = !q && groupNames.length >= 2;

  const row = (t: ToolSlot) => (
    <ToolRow
      key={t.id}
      tool={t}
      snap={snap}
      current={view === toolView(section.id, t.id)}
      onOpen={() => {
        openTool(section.id, t.id);
        // Already on this tool: the view doesn't change, so the shell's close-on-open never fires.
        if (view === toolView(section.id, t.id)) dispatch({ type: 'close-drawer' });
      }}
    />
  );

  return (
    <div className="drawer-split">
      {tools.length > SECTION_SEARCH_FROM ? (
        <div className="drawer-tools">
          <Icon name="search" size={16} />
          <label className="visually-hidden" htmlFor={searchId}>
            Search {section.title}
          </label>
          <input
            id={searchId}
            type="search"
            className="field"
            placeholder={`Search ${section.title}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      ) : null}
      <div className="drawer-scroll">
        <div className="drawer-body">
          {shown.length === 0 ? (
            <p className="dock-empty">
              {q ? 'Nothing matches that search.' : 'Nothing here is open to you yet.'}
            </p>
          ) : grouped ? (
            groupNames.map((g) => {
              const inGroup = tools.filter((t) => t.group === g);
              return (
                <Fold key={g} title={g} count={inGroup.length}>
                  <ul className="drawer-list">{inGroup.map(row)}</ul>
                </Fold>
              );
            })
          ) : (
            <ul className="drawer-list">{shown.map(row)}</ul>
          )}
          {grouped
            ? (() => {
                const loose = tools.filter((t) => !t.group);
                return loose.length > 0 ? <ul className="drawer-list">{loose.map(row)}</ul> : null;
              })()
            : null}
        </div>
      </div>
    </div>
  );
}
