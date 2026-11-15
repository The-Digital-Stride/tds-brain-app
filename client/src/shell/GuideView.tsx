import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { HelpTopic } from '../help/contract.ts';
import { HelpArticle } from '../help/HelpArticle.tsx';
import { helpImageUrl, helpLibrary, helpRoleWords } from '../help/library.ts';
import { renderHelp } from '../help/render.ts';

/**
 * The Cortex Guide: the whole help as a book (owners only for now). Contents on the left, the page on the
 * right; under 900px the contents become a picker above the page. Printing prints every page in order from a
 * hidden copy (`.guide-print`, see guide.css).
 */
export function GuideView() {
  const groups = useMemo(() => helpLibrary.groups(), []);
  const [id, setId] = useState(() => groups[0]?.topics[0]?.id ?? '');
  const topic = helpLibrary.byId(id);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const pickerId = useId();

  const go = (to: string) => {
    if (!helpLibrary.byId(to)) return;
    moved.current = true;
    setId(to);
  };

  // On opening, the page's heading takes focus. After a frame, so it lands after a closing drawer hands focus back.
  useEffect(() => {
    const frame = requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);

  // After moving to another page: back to the top of the sheet, and the page's heading takes focus.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `id` is the trigger, not a value the effect reads.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    heading.current?.closest('.sheet-scroll')?.scrollTo?.({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [id]);

  const printed = useMemo(
    () =>
      helpLibrary.topics.map((t) => ({
        topic: t,
        html: renderHelp(t.body, helpImageUrl, { eager: true }),
      })),
    [],
  );

  const related = (topic?.related ?? [])
    .map((r) => helpLibrary.byId(r))
    .filter((t): t is HelpTopic => t !== undefined);

  return (
    <div className="guide">
      <nav className="guide-contents" aria-label="Contents">
        {groups.map((g) => (
          <section key={g.area}>
            <p className="guide-area" id={`${pickerId}-${g.area}`}>
              {g.label}
            </p>
            <ul className="drawer-list" aria-labelledby={`${pickerId}-${g.area}`}>
              {g.topics.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className="line"
                    aria-current={t.id === id ? 'true' : undefined}
                    onClick={() => go(t.id)}
                  >
                    <span className="line-text">
                      <span className="line-title">{t.title}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
      <div className="guide-picker">
        <label htmlFor={pickerId} className="setting-label">
          Page
        </label>
        <select id={pickerId} className="field" value={id} onChange={(e) => go(e.target.value)}>
          {groups.map((g) => (
            <optgroup key={g.area} label={g.label}>
              {g.topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      {topic ? (
        <article className="guide-page" aria-labelledby={`${pickerId}-title`}>
          <div className="guide-page-head">
            <h2 id={`${pickerId}-title`} ref={heading} tabIndex={-1}>
              {topic.title}
            </h2>
            {helpRoleWords(topic.roles) ? <span className="badge">{helpRoleWords(topic.roles)}</span> : null}
          </div>
          <HelpArticle topic={topic} onOpen={go} />
          {related.length > 0 ? (
            <section className="guide-related" aria-labelledby={`${pickerId}-related`}>
              <h3 id={`${pickerId}-related`}>Related</h3>
              <ul>
                {related.map((t) => (
                  <li key={t.id}>
                    <button type="button" className="btn" data-variant="quiet" onClick={() => go(t.id)}>
                      {t.title}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </article>
      ) : null}
      {/* The print copy: every page, in order. Hidden on screen. */}
      <div className="guide-print" aria-hidden="true">
        {printed.map(({ topic: t, html }) => (
          <section key={t.id} className="guide-print-page" data-page={t.id}>
            <h2>{t.title}</h2>
            {/* biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised by renderHelp. */}
            <div className="help-article" dangerouslySetInnerHTML={{ __html: html }} />
          </section>
        ))}
      </div>
    </div>
  );
}
