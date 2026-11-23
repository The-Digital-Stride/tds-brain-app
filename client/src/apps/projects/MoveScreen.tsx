import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  ProjectCard,
  ProjectMoveCheckResponse,
  ProjectMoveResult,
} from '../../../../shared/projects-contract.ts';
import { ApiFailure, api } from '../../api.ts';
import { Confirm } from '../../shell/Confirm.tsx';
import { SearchSelect } from '../../shell/SearchSelect.tsx';
import type { PickOption } from '../../shell/search-select.ts';
import { useProjects } from '../../state/projects.ts';
import { errorWords, plural } from './logic.ts';

type Client = { slug: string; name: string; aliases?: string[] };

const SHOWN_FILES = 10;
/** The server's words when the folder's files changed after the check (security review). */
const FILES_CHANGED = /^The files in this project changed since you checked\b/;

/** The words under the question in the confirm: what moves, what is shared, what can't be undone. */
export function ConfirmText({
  card,
  clients,
  target,
  answer,
}: {
  card: ProjectCard;
  clients: readonly Client[];
  target: Client;
  answer: ProjectMoveCheckResponse;
}) {
  const { check } = answer;
  const fromPersonal = card.space === 'personal';
  const oldName = clients.find((c) => c.slug === card.client)?.name ?? card.client ?? '';
  const shown = check.files.slice(0, SHOWN_FILES).map((f) => f.split('/').pop() ?? f);
  const more = check.fileCount - shown.length;
  return (
    <>
      {fromPersonal ? (
        <>
          <p>
            Everything in this project's folder will be shared with the team:{' '}
            {plural(check.fileCount, 'file')}.
          </p>
          {shown.length > 0 ? (
            <ul className="proj-move-files">
              {shown.map((f, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: two files can share a name in different folders.
                <li key={`${i}-${f}`}>{f}</li>
              ))}
              {more > 0 ? <li>and {more} more</li> : null}
            </ul>
          ) : null}
          {check.ignoredCount > 0 ? (
            <p>
              {plural(check.ignoredCount, 'file')} won't be shared, because the brain doesn't sync files of
              that type (such as videos and zips). They stay on this Mac.
            </p>
          ) : null}
          <p>Your to-dos for it move with it. You can't make it personal again.</p>
          {check.personalLinks.length > 0 ? (
            <p>
              {plural(check.personalLinks.length, 'linked personal file')} from outside this project will be
              unlinked, so they stay private.
            </p>
          ) : null}
        </>
      ) : (
        <p>
          Its folder moves from {oldName} to {target.name}. {plural(answer.todos, 'open to-do')} move with it.
        </p>
      )}
      <p>
        Ask the team to sync first, so nobody adds files to the old folder meanwhile. This can't be undone
        here.
      </p>
    </>
  );
}

/**
 * Move a project to another client: pick the client, see what would happen (a check that writes
 * nothing), then confirm. One script call does the move.
 */
export function MoveScreen({
  card,
  clients,
  onCancel,
  onMoved,
}: {
  card: ProjectCard;
  clients: readonly Client[];
  onCancel: () => void;
  onMoved: (result: ProjectMoveResult, clientName: string) => void;
}) {
  const { apply } = useProjects();
  const base = useId();
  const [client, setClient] = useState('');
  const [answer, setAnswer] = useState<ProjectMoveCheckResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const continueBtn = useRef<HTMLButtonElement>(null);
  // Set when a refusal drops the check, so focus lands on Continue rather than nowhere.
  const dropped = useRef(false);
  const options = useMemo<PickOption[]>(
    () =>
      clients
        .filter((c) => c.slug !== card.client)
        .map((c) => ({ value: c.slug, label: c.name, terms: c.aliases, group: 'Clients' })),
    [clients, card.client],
  );
  const target = clients.find((c) => c.slug === client) ?? null;

  useEffect(() => {
    if (!answer && dropped.current) {
      dropped.current = false;
      continueBtn.current?.focus();
    }
  }, [answer]);

  const fail = (err: unknown) => {
    if (err instanceof ApiFailure) {
      // The routes send `exists` as `changed` (409), so a clash is told apart by its message too.
      const code: string = err.code;
      const clash = code === 'exists' || (code === 'changed' && /already/i.test(err.message));
      setProblem(
        clash
          ? `${target?.name ?? 'That client'} already has a project with the folder name ${card.slug}.`
          : code === 'changed' && FILES_CHANGED.test(err.message)
            ? err.message
            : errorWords(err.code, err.message),
      );
      // A stale check (files, card or the destination changed): back to the picker to check again.
      if (code === 'changed' || code === 'exists') {
        dropped.current = answer !== null;
        setAnswer(null);
      }
    } else setProblem(errorWords('internal'));
  };

  const check = async () => {
    if (busy) return;
    if (!target) {
      setProblem('Choose a client to move it to.');
      return;
    }
    setBusy(true);
    setProblem('');
    try {
      setAnswer(await api.checkProjectMove({ key: card.key, client: target.slug, expect: card.version }));
    } catch (err) {
      fail(err);
    }
    setBusy(false);
  };

  const move = async () => {
    if (busy || !target || !answer) return;
    setBusy(true);
    setProblem('');
    try {
      const res = await api.moveProject({
        key: card.key,
        client: target.slug,
        expect: card.version,
        ...(answer.check.personalLinks.length > 0 ? { dropPersonal: true as const } : {}),
        // Security review: the move is refused if the folder's files aren't the ones listed here.
        filesExpect: answer.check.filesVersion,
      });
      apply(res.list);
      setBusy(false);
      onMoved(res, target.name);
      return;
    } catch (err) {
      fail(err);
    }
    setBusy(false);
  };

  const question = `Move this project to ${target?.name ?? ''}?`;
  return (
    <section className="proj-form-page" aria-label={`Move ${card.title}`}>
      <div className="proj-head">
        <h2 className="proj-title">Move {card.title}</h2>
      </div>
      {problem ? (
        <p className="notice" data-level="error" data-shape="box" role="alert">
          {problem}
        </p>
      ) : null}
      {answer && target ? (
        <Confirm
          label={question}
          text={
            <>
              <strong className="proj-move-q">{question}</strong>
              <span className="proj-move-text">
                <ConfirmText card={card} clients={clients} target={target} answer={answer} />
              </span>
            </>
          }
          action={`Move to ${target.name}`}
          variant="primary"
          busy={busy}
          onConfirm={() => void move()}
          onCancel={onCancel}
        />
      ) : (
        // biome-ignore lint/a11y/noStaticElementInteractions: only listens for Esc bubbling from its own buttons and fields.
        <section
          className="card proj-card proj-form"
          onKeyDown={(e) => {
            // The picker's own Escape (closing its list) stops there; any other Escape is Cancel.
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }}
        >
          <div className="form-field">
            <label htmlFor={`${base}-to`}>Move to</label>
            <SearchSelect
              id={`${base}-to`}
              value={client}
              options={options}
              onChange={(v) => {
                setClient(v);
                setProblem('');
              }}
              recentKey="clients"
              placeholder="Choose a client"
              aria-describedby={`${base}-hint`}
            />
            <p className="hint" id={`${base}-hint`}>
              The folder name, {card.slug}, stays the same.
            </p>
          </div>
          <div className="proj-buttons">
            <button
              type="button"
              className="btn"
              data-variant="primary"
              aria-disabled={busy || undefined}
              ref={continueBtn}
              onClick={() => void check()}
            >
              Continue
            </button>
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </section>
      )}
    </section>
  );
}
