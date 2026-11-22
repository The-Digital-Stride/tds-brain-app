import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type {
  ProjectCard,
  ProjectRemoveCheckResponse,
  ProjectRemoveResult,
} from '../../../../shared/projects-contract.ts';
import { ApiFailure, api } from '../../api.ts';
import { useProjects } from '../../state/projects.ts';
import { errorWords, plural, refusalWords, sizeWords } from './logic.ts';

type Do = 'done' | 'keep' | 'delete' | 'unlink';

const SHOWN_REFS = 20;

/** What the person sees when archive or delete is refused for a reason they can act on. */
export function notAllowedWords(verb: string, who: string): string {
  return who ? `Only ${who} can ${verb} this project.` : `You can't ${verb} this project.`;
}

/** The delete confirm lets go only when the typed words are the project's title (trimmed, any case). */
export function titleMatches(typed: string, title: string): boolean {
  return typed.trim().toLowerCase() === title.trim().toLowerCase() && title.trim() !== '';
}

/** The to-do count words for a result: "3 to-dos changed. 1 couldn't be changed." */
export function resultWords(base: string, res: ProjectRemoveResult): string {
  const bits = [base];
  if (res.todosChanged > 0) bits.push(`${plural(res.todosChanged, 'to-do')} changed.`);
  if (res.todosFailed.length > 0)
    bits.push(
      `${plural(res.todosFailed.length, 'to-do')} couldn't be changed (${res.todosFailed.join(', ')}). They still point at this project.`,
    );
  return bits.join(' ');
}

function References({ list, count, lead }: { list: string[]; count: number; lead: string }) {
  if (list.length === 0) return null;
  const more = count - Math.min(list.length, SHOWN_REFS);
  return (
    <>
      <p>{lead}</p>
      <ul className="proj-move-files">
        {list.slice(0, SHOWN_REFS).map((r) => (
          <li key={r}>{r}</li>
        ))}
        {more > 0 ? <li>and {more} more</li> : null}
      </ul>
    </>
  );
}

/**
 * The archive and delete confirm: runs a check that writes nothing, shows what it found, then sends the
 * real call with `expect` and `filesExpect` (as the Move panel does). Esc and Cancel leave it.
 */
export function RemovePanel({
  card,
  mode,
  me,
  onCancel,
  onDone,
}: {
  card: ProjectCard;
  mode: 'archive' | 'delete';
  me: string;
  onCancel: () => void;
  onDone: (res: ProjectRemoveResult) => void;
}) {
  const { apply } = useProjects();
  const base = useId();
  const [answer, setAnswer] = useState<ProjectRemoveCheckResponse | null>(null);
  const [choice, setChoice] = useState<Record<string, Do>>({});
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const cancelBtn = useRef<HTMLButtonElement>(null);
  const deleting = mode === 'delete';
  const expect = card.card === 'ok' ? card.version : undefined;

  const runCheck = useCallback(async () => {
    try {
      const res = await api.checkProjectRemove({
        key: card.key,
        action: mode,
        ...(expect ? { expect } : {}),
      });
      setAnswer(res);
      setChoice(
        Object.fromEntries(
          res.todos.map((t): [string, Do] => [
            t.id,
            deleting ? (t.assignee === null || t.assignee === me ? 'delete' : 'unlink') : 'keep',
          ]),
        ),
      );
    } catch (err) {
      setProblem(err instanceof ApiFailure ? refusalWords(err.code, err.message) : errorWords('internal'));
    }
  }, [card.key, mode, expect, deleting, me]);

  useEffect(() => {
    void runCheck();
  }, [runCheck]);
  useEffect(() => {
    cancelBtn.current?.focus();
  }, []);

  const confirm = async () => {
    if (busy || !answer) return;
    setBusy(true);
    setProblem('');
    try {
      const res = await api.removeProject({
        key: card.key,
        action: mode,
        ...(expect ? { expect } : {}),
        filesExpect: answer.check.filesVersion,
        todos: answer.todos.map((t) => ({
          id: t.id,
          scope: t.scope,
          version: t.version,
          do: choice[t.id] ?? (deleting ? 'unlink' : 'keep'),
        })),
      });
      // The parent leaves the page first, so a deleted project's page never shows an empty state.
      onDone(res);
      apply(res.list);
      return;
    } catch (err) {
      if (err instanceof ApiFailure) {
        setProblem(refusalWords(err.code, err.message));
        // A stale check (someone changed the folder): check again so the panel tells the truth.
        const code: string = err.code;
        if (code === 'changed' || code === 'exists') {
          setAnswer(null);
          void runCheck();
        }
      } else setProblem(errorWords('internal'));
    }
    setBusy(false);
  };

  const check = answer?.check;
  const allowed = check ? check.allowed : true;
  const matches = titleMatches(typed, card.title);
  const open = answer?.todos ?? [];
  const label = deleting ? 'Delete' : 'Archive';
  const options: { value: Do; text: string }[] = deleting
    ? [
        { value: 'delete', text: 'Delete' },
        { value: 'unlink', text: 'Keep, unlinked' },
      ]
    : [
        { value: 'done', text: 'Mark done' },
        { value: 'keep', text: 'Keep open' },
      ];

  return (
    <fieldset
      className="proj-ask proj-move-ask proj-remove-ask"
      aria-describedby={`${base}-desc`}
      data-danger={deleting || undefined}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }}
    >
      <legend className="proj-ask-q">
        {deleting ? `Delete ${card.title} for good?` : `Archive ${card.title}?`}
      </legend>
      <div className="proj-move-text" id={`${base}-desc`}>
        {problem ? (
          <p className="proj-error" role="alert">
            {problem}
          </p>
        ) : null}
        {!check ? (
          problem ? null : (
            <p role="status">Checking what this will change…</p>
          )
        ) : deleting ? (
          <>
            <p>
              This deletes the folder {check.from} and everything in it: {plural(check.fileCount, 'file')} (
              {plural(check.images, 'image')}, {plural(check.documents, 'document')}, {check.other} other,{' '}
              {sizeWords(check.bytes)}).
            </p>
            {check.localOnlyCount > 0 ? (
              <p className="proj-remove-warn">
                {check.localOnlyCount === 1
                  ? "1 file exists only on this Mac and can't be recovered."
                  : `${check.localOnlyCount} files exist only on this Mac and can't be recovered.`}
              </p>
            ) : null}
            <p>Other files can be recovered from the brain's history by someone technical.</p>
            <References list={check.references} count={check.referenceCount} lead="These links will break:" />
          </>
        ) : (
          <>
            <p>
              Its folder moves from {check.from} to {check.to}. {plural(check.fileCount, 'file')}, and nothing
              is deleted. You can unarchive it later.
            </p>
            <References
              list={check.references}
              count={check.referenceCount}
              lead="These files point into this folder:"
            />
          </>
        )}
        {check && open.length > 0 ? (
          <>
            <p>{deleting ? 'Open to-dos linked to this project:' : 'Open to-dos for this project:'}</p>
            <ul className="proj-remove-todos">
              {open.map((t) => (
                <li key={t.id} className="proj-remove-todo">
                  <span className="proj-remove-title">{t.title}</span>
                  <span className="proj-remove-opts">
                    {options.map((o) => (
                      <label key={o.value} className="proj-remove-opt">
                        <input
                          type="radio"
                          name={`${base}-${t.id}`}
                          checked={choice[t.id] === o.value}
                          onChange={() => setChoice((c) => ({ ...c, [t.id]: o.value }))}
                          aria-label={`${o.text}: ${t.title}`}
                        />
                        {o.text}
                      </label>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {answer ? (
          <>
            {answer.doneTodos > 0 ? (
              <p>
                {answer.doneTodos === 1
                  ? '1 finished to-do stays as it is.'
                  : `${answer.doneTodos} finished to-dos stay as they are.`}
              </p>
            ) : null}
            {deleting ? (
              <>
                <p>Deleted to-dos go to the deleted folder and can be brought back.</p>
                <p>Chats are kept.</p>
              </>
            ) : null}
          </>
        ) : null}
        {check && deleting && !allowed ? <p>{notAllowedWords('delete', check.allowedWho)}</p> : null}
        {check && !deleting && !allowed ? <p>{notAllowedWords('archive', check.allowedWho)}</p> : null}
        {check && deleting && allowed ? (
          <div className="proj-field">
            <label htmlFor={`${base}-type`}>Type the project name to delete it</label>
            <input
              id={`${base}-type`}
              className="field"
              type="text"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
        ) : null}
      </div>
      <div className="proj-buttons">
        {check && allowed ? (
          <button
            type="button"
            className="btn"
            data-variant={deleting ? 'danger' : 'primary'}
            disabled={busy || (deleting && !matches)}
            onClick={() => void confirm()}
          >
            {label}
          </button>
        ) : null}
        <button type="button" className="btn" ref={cancelBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </fieldset>
  );
}
