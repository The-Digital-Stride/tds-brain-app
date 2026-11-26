import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PROJECT_CHATS_MAX,
  type ProjectChat,
  type ProjectChatsProps,
  type ProjectChatsResponse,
} from '../../../../shared/project-chats-contract.ts';
import { api } from '../../api.ts';
import { StateNote } from '../../shell/StateNote.tsx';
import { useStore } from '../../store.tsx';
import { dateWords } from './logic.ts';

/** The details line: when, then (only when saving is possible and known) whether it is saved here. */
function detailsWords(c: ProjectChat, open: boolean, canSave: boolean): string {
  const parts = [open ? 'Open now' : `Last active ${dateWords(c.lastActive)}`];
  if (canSave && c.saved) {
    const on = c.savedAt ? dateWords(c.savedAt) : '';
    if (c.saved === 'never') parts.push('not saved yet');
    else if (c.saved === 'new') parts.push(`new messages since you saved${on ? ` on ${on}` : ''}`);
    else parts.push(on ? `saved ${on}` : 'saved');
  }
  return parts.join(' · ');
}

/**
 * A project's Chats tab (plan 2026-11-26-project-chats-tab): this person's chats for the project on this Mac, each
 * opening beside the project, with Save to project where it makes sense. Read-only: nothing is saved here.
 */
export function ProjectChats({ projectKey, movedFrom, canStart, onSave }: ProjectChatsProps) {
  const { sessions, openChat, openPast } = useStore();
  const [got, setGot] = useState<{ key: string; data: ProjectChatsResponse } | null>(null);
  const [failed, setFailed] = useState(false);
  const [openError, setOpenError] = useState('');
  const latest = useRef(0);
  const live = useRef(projectKey);
  live.current = projectKey;

  // The project's chats in the store: when this changes (one started, ended, renamed, deleted) the list is read again.
  const keys = new Set<string>([projectKey, ...movedFrom]);
  const stamp = sessions
    ? [
        ...sessions.live
          .filter((s) => s.project && keys.has(s.project))
          .map((s) => `l:${s.sdkSessionId ?? ''}:${s.title}:${s.state}`),
        ...sessions.past
          .filter((s) => s.project && keys.has(s.project))
          .map((s) => `p:${s.sdkSessionId}:${s.title}:${s.lastModified}`),
      ]
        .sort()
        .join('|')
    : '';

  const load = useCallback(() => {
    const mine = ++latest.current;
    api.projectChats(projectKey).then(
      (r) => {
        // A newer read, or another project, has taken over: this answer is out of date.
        if (mine !== latest.current || live.current !== projectKey) return;
        setGot({ key: projectKey, data: r });
        setFailed(false);
      },
      () => {
        if (mine === latest.current && live.current === projectKey) setFailed(true);
      },
    );
  }, [projectKey]);

  // `stamp` is a trigger only: it isn't read inside.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read when the project's chats in the store change
  useEffect(() => {
    load();
  }, [load, stamp]);

  // A message about one project's chat doesn't carry over to another project.
  // biome-ignore lint/correctness/useExhaustiveDependencies: clear on project change
  useEffect(() => {
    setOpenError('');
  }, [projectKey]);

  const data = got && got.key === projectKey ? got.data : null;
  const liveById = new Map(
    (sessions?.live ?? []).flatMap((s) => (s.sdkSessionId ? [[s.sdkSessionId, s.id]] : [])),
  );
  const known = sessions ? new Set([...liveById.keys(), ...sessions.past.map((p) => p.sdkSessionId)]) : null;
  const rows = data ? data.chats.filter((c) => !known || known.has(c.chat)) : [];

  const open = async (c: ProjectChat) => {
    setOpenError('');
    const liveId = liveById.get(c.chat);
    if (liveId) {
      openChat(liveId, { in: 'drawer' });
      return;
    }
    if (!(await openPast(c.chat, { in: 'drawer' }))) setOpenError("That chat can't be opened on this Mac.");
  };

  const retry = () => {
    setFailed(false);
    load();
  };

  // In the tray, like the other tabs' cards: it gives the card its backing and lines the hint up with the heading.
  return (
    <div className="tray lib-tray">
      <section className="card proj-card" aria-labelledby="proj-chats">
        <div className="card-head">
          <h3 id="proj-chats">Your chats for this project</h3>
        </div>
        <p className="hint">Only you can see these. They stay on this Mac.</p>
        {openError ? (
          <p className="notice" data-level="error" data-shape="box" role="alert">
            {openError}
          </p>
        ) : null}
        {!data && failed ? (
          <StateNote kind="error" onRetry={retry}>
            The chats couldn't be read.
          </StateNote>
        ) : !data ? (
          <StateNote kind="loading">Loading chats…</StateNote>
        ) : rows.length === 0 ? (
          <StateNote kind="empty">
            No chats for this project on this Mac yet.
            {canStart ? (
              <>
                {' '}
                Press <strong>New chat for this project</strong> to start one.
              </>
            ) : null}
          </StateNote>
        ) : (
          <>
            <ul className="lib-list">
              {rows.map((c) => {
                const liveNow = liveById.has(c.chat);
                return (
                  <li className="line" key={c.chat}>
                    <button type="button" className="line-main" onClick={() => void open(c)}>
                      <span className="line-text">
                        <span className="line-title">{c.title}</span>
                        <span className="line-meta">{detailsWords(c, liveNow, data.canSave)}</span>
                      </span>
                    </button>
                    {data.canSave && !c.busy && c.saved !== 'saved' ? (
                      <button
                        type="button"
                        className="btn"
                        data-size="small"
                        aria-label={`Save to project: ${c.title}`}
                        onClick={() => onSave({ key: projectKey, chat: c.chat, title: c.title })}
                      >
                        Save to project
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {failed ? (
              <StateNote kind="error" onRetry={retry}>
                The chats couldn't be read.
              </StateNote>
            ) : null}
          </>
        )}
        {data?.more ? (
          <p className="hint">
            Showing the newest {PROJECT_CHATS_MAX} chats. Older ones are in the Chats drawer.
          </p>
        ) : null}
      </section>
    </div>
  );
}
