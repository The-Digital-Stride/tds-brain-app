import { useEffect, useId, useMemo, useState } from 'react';
import type { BusinessContact } from '../../../../shared/project-business-contract.ts';
import { gmailComposeUrl } from '../../../../shared/project-email-threads-contract.ts';
import type { ProjectCard, ProjectList } from '../../../../shared/projects-contract.ts';
import { Confirm } from '../../shell/Confirm.tsx';
import { openGmailWindow } from '../../shell/gmail-window.ts';
import { useCopy } from '../../shell/useCopy.ts';
import { useStore } from '../../store.tsx';
import { composeContacts, contactWords, SOMEONE_ELSE } from './compose.ts';
import { useProjectChange } from './useChange.ts';

/** What gets copied: the code in square brackets, so it stands out in a subject line. */
export const bracketed = (ref: string) => `[${ref}]`;

/**
 * The project's code on its Overview (R2 phase 4b, decision 9). Which words and buttons show depends on the
 * card's `refState`; an older server sends none, and a personal project has no code, so both show nothing.
 *
 * Under the code, "Write an email" opens Gmail's compose window in a small window beside the project, the
 * code line already in it (Gmail can't be shown inside another page). When the client's files give contacts
 * with an email address, an "Email to" list picks who it goes to; the first (the main contact) is chosen to
 * start with, and "Someone else" leaves Gmail's To empty. The row waits for the contacts (`contactsReady`)
 * so the button never moves under the pointer.
 */
export function ProjectRef({
  card,
  list,
  title,
  contacts,
  contactsReady = true,
}: {
  card: ProjectCard;
  list: ProjectList;
  /** The other project's title for a duplicate, when the list has it. */
  title: (key: string) => string;
  /** The client's contacts with an address (`ProjectBusinessResponse.contacts`); none from an older server. */
  contacts?: readonly BusinessContact[];
  /** False while the client's files are still being read. */
  contactsReady?: boolean;
}) {
  const { boot } = useStore();
  const change = useProjectChange({ reloadOnChanged: true });
  const { said, copy } = useCopy();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState('');
  // Which `data-focus` element gets focus once the next render has put it on the page.
  const [focusOn, setFocusOn] = useState<string | null>(null);
  const toId = useId();
  const ownEmail = boot?.identity.email ?? null;
  const people = useMemo(() => composeContacts(contacts, ownEmail), [contacts, ownEmail]);
  // The pick belongs to one project: another project starts again at its own first contact.
  const [picked, setPicked] = useState<{ key: string; email: string } | null>(null);
  const kept =
    picked &&
    picked.key === card.key &&
    (picked.email === '' || people.some((c) => c.email === picked.email));
  const to = kept && picked ? picked.email : (people[0]?.email ?? '');
  const state = card.refState;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the card's code and state changing is what puts the target on the page.
  useEffect(() => {
    if (!focusOn) return;
    const el = document.querySelector<HTMLElement>(`[data-focus="${focusOn}"]`);
    if (!el) return;
    el.focus();
    setFocusOn(null);
  }, [focusOn, card.ref, state]);
  if (!state || state === 'personal') return null;
  const canRef = list.canRef === true && list.canChange && !card.archived && card.card === 'ok';

  const send = async (replace: boolean) => {
    if (busy) return;
    setBusy(true);
    setProblem('');
    const res = await change({
      kind: 'ref',
      key: card.key,
      expect: card.version,
      ...(replace ? { replace: true as const } : {}),
    });
    setBusy(false);
    setAsking(false);
    if (!res.ok) {
      setProblem(res.message);
      return;
    }
    setFocusOn('copyref');
  };

  const ref = card.ref ?? '';
  const other = card.refDuplicateOf?.[0];
  const otherTitle = other ? title(other) : 'another project';
  const shown = state === 'ok' && ref !== '';
  const duplicate = state === 'duplicate' && ref !== '';
  const composeUrl = gmailComposeUrl(ownEmail, ref, to === '' ? undefined : to);
  return (
    <div className="proj-ref">
      <div className="proj-ref-row">
        <span className="proj-ref-label">Project code</span>
        {shown ? (
          <>
            <code className="proj-ref-code">{ref}</code>
            <button
              type="button"
              className="btn"
              data-size="small"
              data-focus="copyref"
              aria-label={`Copy code ${ref}`}
              onClick={() => void copy(bracketed(ref))}
            >
              {said ?? 'Copy'}
            </button>
            <span className="visually-hidden" role="status">
              {said ?? ''}
            </span>
          </>
        ) : null}
        {duplicate ? <code className="proj-ref-code">{ref}</code> : null}
        {state === 'missing' && canRef ? (
          <button
            type="button"
            className="btn"
            data-size="small"
            aria-disabled={busy || undefined}
            onClick={() => void send(false)}
          >
            Make a code
          </button>
        ) : null}
        {state === 'missing' && !canRef ? <span className="proj-note">No code yet</span> : null}
        {state === 'no-client-code' ? <span className="proj-note">Add a client code first</span> : null}
      </div>
      {shown ? (
        <div className="proj-ref-row proj-ref-email">
          {contactsReady ? (
            <>
              {people.length > 0 ? (
                <>
                  <label className="proj-ref-label" htmlFor={toId}>
                    Email to
                  </label>
                  <select
                    id={toId}
                    className="field proj-ref-to"
                    value={to}
                    onChange={(e) => setPicked({ key: card.key, email: e.target.value })}
                  >
                    {people.map((c) => (
                      <option key={c.email} value={c.email}>
                        {contactWords(c)}
                      </option>
                    ))}
                    <option value="">{SOMEONE_ELSE}</option>
                  </select>
                </>
              ) : null}
              <a
                className="btn"
                href={composeUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => openGmailWindow(e, composeUrl)}
              >
                Write an email<span className="visually-hidden"> (opens Gmail in a small window)</span>
              </a>
            </>
          ) : null}
        </div>
      ) : null}
      {state === 'duplicate' ? (
        <p className="proj-note">
          This code is also used by {otherTitle}.
          {canRef && !asking ? (
            <>
              {' '}
              <button
                type="button"
                className="btn"
                data-size="small"
                data-focus="newref"
                onClick={() => setAsking(true)}
              >
                Make a new code
              </button>
            </>
          ) : null}
        </p>
      ) : null}
      {asking ? (
        <Confirm
          label="Make a new code"
          text={`${ref} will then mean ${otherTitle}.`}
          action="Make a new code"
          variant="primary"
          busy={busy}
          onConfirm={() => void send(true)}
          onCancel={() => {
            setAsking(false);
            setFocusOn('newref');
          }}
        />
      ) : null}
      {shown ? (
        <p className="proj-note">
          Write an email opens Gmail in a small window with this code already in it.
          {people.length > 0 ? " The people listed come from the client's contacts in the brain." : ''} You
          can also paste the code into a meeting invite or any email.
        </p>
      ) : null}
      {problem ? (
        <p className="notice" data-level="error" data-shape="box" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
