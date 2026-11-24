import { useCallback, useEffect, useRef, useState } from 'react';
import type { EmailDraftItem } from '../../../../shared/project-email-contract.ts';
import type { ProjectKey, ProjectList } from '../../../../shared/projects-contract.ts';
import { api } from '../../api.ts';
import { ShowMore } from '../../shell/ShowMore.tsx';
import { type ApprovalResult, EmailApproval, type EmailProjectOption } from './EmailApproval.tsx';
import { dateWords } from './logic.ts';

/** Rows shown before "Show N more emails", as Home's cards. */
const ROWS = 5;

/**
 * "Waiting for your OK": emails Claude drafted from this person's inbox, each needing a yes before anything reaches a
 * project. On the Projects list it shows every draft; with `projectKey` (a project's Overview) only those routed to
 * that project. Shows nothing when there are none, or when the script can't take approvals.
 */
export function EmailDrafts({
  list,
  clients,
  projectKey,
  onSaved,
}: {
  list: ProjectList;
  clients: readonly { slug: string; name: string }[];
  projectKey?: ProjectKey;
  /** An email was saved to this project: the page refreshes what it shows. */
  onSaved?: (key: ProjectKey) => void;
}) {
  const [drafts, setDrafts] = useState<EmailDraftItem[]>([]);
  const [canApprove, setCanApprove] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState('');
  const live = useRef(projectKey);
  live.current = projectKey;
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    const key = projectKey;
    try {
      const r = await api.projectEmailDrafts(key);
      if (live.current !== key) return;
      setDrafts(r.drafts);
      setCanApprove(r.canApprove);
    } catch {
      // A card that can't load stays out of the way; the rest of the page works without it.
      if (live.current === key) setDrafts([]);
    }
  }, [projectKey]);

  useEffect(() => {
    setOpenId(null);
    setNotice('');
    void load();
  }, [load]);

  const titleOf = (key: string | null) =>
    (key && list.projects.find((p) => p.key === key)?.title) || 'a project';
  const options = (draft: EmailDraftItem): EmailProjectOption[] =>
    list.projects
      .filter((p) => p.key === draft.route.key || (!p.archived && p.card === 'ok' && p.status !== 'done'))
      .map((p) => ({
        key: p.key,
        label: p.client
          ? `${clients.find((c) => c.slug === p.client)?.name ?? p.client}: ${p.title}`
          : p.title,
      }));

  const finished = async (result: ApprovalResult) => {
    setOpenId(null);
    if (result.done === 'exists')
      setNotice(`Already in ${titleOf(result.key)}${result.byName ? `, added by ${result.byName}` : ''}.`);
    else if (result.done === 'saved') setNotice('Saved to the project.');
    else if (result.done === 'dismissed') setNotice('Left out of your projects.');
    await load();
    if (result.done === 'saved') onSaved?.(result.key);
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  const open = drafts.find((d) => d.id === openId) ?? null;
  if (!canApprove || (drafts.length === 0 && !notice)) return null;
  const shown = expanded ? drafts : drafts.slice(0, ROWS);

  return (
    <section className="card proj-card" aria-label="Waiting for your OK">
      <div className="card-head">
        <h3 ref={headingRef} tabIndex={-1}>
          Waiting for your OK
        </h3>
      </div>
      {notice ? (
        <p className="notice" data-level="info" data-shape="box" role="status">
          {notice}
          {drafts.length === 0 ? ' Nothing else is waiting.' : null}
        </p>
      ) : null}
      {open ? (
        <EmailApproval key={open.id} draft={open} projects={options(open)} onDone={(r) => void finished(r)} />
      ) : (
        <>
          <ul className="lib-list">
            {shown.map((d) => (
              <li key={d.id}>
                <div className="line proj-update proj-email-row">
                  <div className="proj-update-body">
                    <span className="line-title proj-email-subject">{d.subject}</span>
                    <span className="line-meta">
                      From {d.from} · {dateWords(d.sentAt)}
                      {/* On the list, where each email is headed (UX review). */}
                      {projectKey ? null : ` · ${d.route.key ? titleOf(d.route.key) : 'No project yet'}`}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn"
                    data-size="small"
                    aria-label={`Review email: ${d.subject}`}
                    onClick={() => {
                      setNotice('');
                      setOpenId(d.id);
                    }}
                  >
                    Review
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {drafts.length > ROWS ? (
            <ShowMore
              expanded={expanded}
              count={drafts.length - ROWS}
              noun={{ one: 'email', many: 'emails' }}
              wording="more"
              onToggle={() => setExpanded((v) => !v)}
            />
          ) : null}
        </>
      )}
    </section>
  );
}
