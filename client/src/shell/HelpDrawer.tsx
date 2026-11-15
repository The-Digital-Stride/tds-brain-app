import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { HELP_FALLBACK_ID, type HelpTopic } from '../help/contract.ts';
import { HelpArticle } from '../help/HelpArticle.tsx';
import { helpLibrary } from '../help/library.ts';
import { Fold } from './Fold.tsx';
import { Icon } from './Icon.tsx';
import { useShell } from './ShellProvider.tsx';

/** A page row: its title, and its summary as the meta line. Opens the page in the drawer. */
function PageRow({ topic, onOpen }: { topic: HelpTopic; onOpen: (id: string) => void }) {
  return (
    <li>
      <button type="button" className="line" onClick={() => onOpen(topic.id)}>
        <span className="line-text">
          <span className="line-title">{topic.title}</span>
          <span className="line-meta">{topic.summary}</span>
        </span>
      </button>
    </li>
  );
}

/** The badge words for a page written for some roles. */
function roleWords(roles: HelpTopic['roles']): string | null {
  if (roles === 'all') return null;
  const owner = roles.includes('owner');
  const scout = roles.includes('scout');
  if (owner && scout) return 'For owners and scouts';
  if (owner) return 'For owners';
  if (scout) return 'For scouts';
  return null;
}

const rows = (topics: readonly HelpTopic[], onOpen: (id: string) => void) => (
  <ul className="drawer-list">
    {topics.map((t) => (
      <PageRow key={t.id} topic={t} onOpen={onOpen} />
    ))}
  </ul>
);

/**
 * The Help drawer (owners only for now). The page for where you are, then one fold per area, with search above
 * that replaces both while it has text. Opening a page from a link or row pushes the one before onto a small
 * history; Back pops it.
 */
export function HelpDrawer() {
  const { state } = useShell();
  const start = helpLibrary.byId(state.helpPage ?? '')?.id ?? HELP_FALLBACK_ID;
  // The pages seen, last one showing. A new start (Help opened again, or a HelpLink pressed) begins afresh.
  const [trail, setTrail] = useState<string[]>([start]);
  const [query, setQuery] = useState('');
  const isOpen = state.drawer === 'help';
  const was = useRef({ start, isOpen });
  const scroll = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const searchId = useId();

  // Help opened again (the body stays mounted while the drawer slides shut), or on another page: begin afresh.
  useEffect(() => {
    const prev = was.current;
    was.current = { start, isOpen };
    if (!isOpen || (prev.isOpen && prev.start === start)) return;
    setTrail([start]);
    setQuery('');
  }, [start, isOpen]);

  const current = trail[trail.length - 1] ?? start;
  const topic = helpLibrary.byId(current) ?? helpLibrary.byId(HELP_FALLBACK_ID);
  const q = query.trim();
  const found = useMemo(() => (q ? helpLibrary.search(q) : null), [q]);
  const groups = useMemo(() => helpLibrary.groups(), []);

  // After moving to another page: back to the top, and the page's heading takes focus.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `current` is the trigger, not a value the effect reads.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    scroll.current?.scrollTo?.({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [current]);

  const open = (id: string) => {
    if (!helpLibrary.byId(id)) return;
    moved.current = true;
    setQuery('');
    setTrail((t) => (t[t.length - 1] === id ? t : [...t, id]));
  };
  const back = () => {
    moved.current = true;
    setTrail((t) => (t.length > 1 ? t.slice(0, -1) : t));
  };

  return (
    <div className="drawer-split">
      <div className="drawer-tools">
        <Icon name="search" size={16} />
        <label className="visually-hidden" htmlFor={searchId}>
          Search help
        </label>
        <input
          id={searchId}
          type="search"
          className="field"
          placeholder="Search help"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="drawer-scroll" ref={scroll}>
        <div className="drawer-body">
          <p className="visually-hidden" role="status" aria-live="polite">
            {found
              ? found.length === 0
                ? 'No help pages match that search.'
                : `${found.length} help ${found.length === 1 ? 'page matches' : 'pages match'}`
              : ''}
          </p>
          {found ? (
            found.length === 0 ? (
              <p className="dock-empty">No help pages match that search.</p>
            ) : (
              rows(found, open)
            )
          ) : (
            <>
              {topic ? (
                <section className="help-page" aria-labelledby={`${searchId}-title`}>
                  {trail.length > 1 ? (
                    <button
                      type="button"
                      className="btn"
                      data-variant="quiet"
                      data-size="small"
                      onClick={back}
                    >
                      <span className="files-back" aria-hidden="true">
                        <Icon name="chevron" size={14} />
                      </span>
                      Back
                    </button>
                  ) : null}
                  <div className="help-page-head">
                    <h3 id={`${searchId}-title`} ref={heading} tabIndex={-1}>
                      {topic.title}
                    </h3>
                    {roleWords(topic.roles) ? <span className="badge">{roleWords(topic.roles)}</span> : null}
                  </div>
                  <HelpArticle topic={topic} onOpen={open} />
                </section>
              ) : null}
              {groups.map((g) => (
                <Fold key={g.area} title={g.label} count={g.topics.length} defaultOpen={false}>
                  {rows(g.topics, open)}
                </Fold>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
