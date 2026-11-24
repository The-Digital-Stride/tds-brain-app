import { useState } from 'react';
import type { ProjectCard, ProjectList } from '../../../../shared/projects-contract.ts';
import { Confirm } from '../../shell/Confirm.tsx';
import { useCopy } from '../../shell/useCopy.ts';
import { useProjectChange } from './useChange.ts';

/** What gets copied: the code in square brackets, so it stands out in a subject line. */
export const bracketed = (ref: string) => `[${ref}]`;

/**
 * The project's code on its Overview (R2 phase 4b, decision 9). Which words and buttons show depends on the
 * card's `refState`; an older server sends none, and a personal project has no code, so both show nothing.
 */
export function ProjectRef({
  card,
  list,
  title,
}: {
  card: ProjectCard;
  list: ProjectList;
  /** The other project's title for a duplicate, when the list has it. */
  title: (key: string) => string;
}) {
  const change = useProjectChange({ reloadOnChanged: true });
  const { said, copy } = useCopy();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState('');
  const state = card.refState;
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
    if (!res.ok) setProblem(res.message);
  };

  const ref = card.ref ?? '';
  const other = card.refDuplicateOf?.[0];
  const otherTitle = other ? title(other) : 'another project';
  const shown = (state === 'ok' || state === 'duplicate') && ref !== '';

  return (
    <section className="proj-ref" aria-label="Project code">
      <div className="proj-ref-row">
        <span className="proj-ref-label">Project code</span>
        {shown ? (
          <>
            <code className="proj-ref-code">{ref}</code>
            <button
              type="button"
              className="btn"
              data-size="small"
              aria-label={`Copy ${bracketed(ref)}`}
              onClick={() => void copy(bracketed(ref))}
            >
              Copy
            </button>
            <span className="visually-hidden" role="status">
              {said ?? ''}
            </span>
            {said ? (
              <span className="proj-ref-said" aria-hidden="true">
                {said}
              </span>
            ) : null}
          </>
        ) : null}
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
        {state === 'missing' && !canRef ? <span className="proj-note">No code yet.</span> : null}
        {state === 'no-client-code' ? <span className="proj-note">Add a client code first</span> : null}
      </div>
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
          onCancel={() => setAsking(false)}
        />
      ) : null}
      {shown ? (
        <p className="proj-note">
          Put this in the meeting invite or the email subject so meetings and emails find this project.
        </p>
      ) : null}
      {problem ? (
        <p className="notice" data-level="error" data-shape="box" role="alert">
          {problem}
        </p>
      ) : null}
    </section>
  );
}
