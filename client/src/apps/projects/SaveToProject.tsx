import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { composeChatSummary, writableChatTitle } from '../../../../shared/chat-summary.ts';
import {
  CHAT_DOCUMENTS_MAX,
  CHAT_FIGURE_MAX,
  CHAT_FIGURES_MAX,
  CHAT_NEXT_STEP_MAX,
  CHAT_NEXT_STEPS_MAX,
  CHAT_OBJECTIVE_MAX,
  CHAT_OUTCOME_MAX,
  type ChatSummaryDoc,
  type ChatSummaryDraft,
  type SaveToProjectProps,
} from '../../../../shared/chat-summary-contract.ts';
import type { TeamMember } from '../../../../shared/contract.ts';
import { ApiFailure, api } from '../../api.ts';
import { Confirm } from '../../shell/Confirm.tsx';
import { StateNote } from '../../shell/StateNote.tsx';
import { Assignee } from '../../shell/TodoForms.tsx';
import { useSheetHold } from '../../shell/useSheetHold.ts';
import { useProjects } from '../../state/projects.ts';
import { useStore } from '../../store.tsx';
import { dateWords } from './logic.ts';
import { useProjectChange } from './useChange.ts';
import { useKeepFocus } from './useKeepFocus.ts';

/** One draft request per chat and project at a time, so a remount (React's double effect) shares it. */
const inFlight = new Map<string, Promise<ChatSummaryDraft>>();
function requestDraft(chat: string, project: string): Promise<ChatSummaryDraft> {
  const id = `${chat}|${project}`;
  let p = inFlight.get(id);
  if (!p) {
    p = api.chatSummaryDraft({ chat, project }).finally(() => {
      inFlight.delete(id);
    });
    inFlight.set(id, p);
  }
  return p;
}

const lines = (text: string): string[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/** "24 Nov 2026" in UK words, from the date in this Mac's clock. */
function todayWords(): string {
  return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function failureWords(err: unknown): string {
  if (err instanceof ApiFailure) {
    if (err.code === 'busy') return 'This chat is busy right now. Wait for it to finish, then try again.';
    if (err.code === 'not-found') return "That chat can't be found on this Mac any more.";
    if (err.code === 'not-allowed') return err.message || "You can't save a chat to this project.";
    if (err.code === 'internal' || !err.message)
      return "Claude couldn't write a summary this time. Try again.";
    return err.message;
  }
  return "Claude couldn't write a summary this time. Try again.";
}

/** Why Save can't be pressed yet, in plain words; '' when it can. */
export function saveBlocker(f: {
  objective: string;
  outcome: string;
  figures: string[];
  nextSteps: string[];
  documents: number;
}): string {
  if (!f.objective.trim()) return 'Write the objective first.';
  if (!f.outcome.trim()) return 'Write the outcome first.';
  if (f.objective.trim().length > CHAT_OBJECTIVE_MAX)
    return `The objective is too long. Keep it under ${CHAT_OBJECTIVE_MAX} characters.`;
  if (f.outcome.trim().length > CHAT_OUTCOME_MAX)
    return `The outcome is too long. Keep it under ${CHAT_OUTCOME_MAX} characters.`;
  if (f.figures.length > CHAT_FIGURES_MAX) return `Use at most ${CHAT_FIGURES_MAX} key figures.`;
  if (f.figures.some((x) => x.length > CHAT_FIGURE_MAX))
    return `Keep each key figure under ${CHAT_FIGURE_MAX} characters.`;
  if (f.nextSteps.length > CHAT_NEXT_STEPS_MAX) return `Use at most ${CHAT_NEXT_STEPS_MAX} next steps.`;
  if (f.nextSteps.some((x) => x.length > CHAT_NEXT_STEP_MAX))
    return `Keep each next step under ${CHAT_NEXT_STEP_MAX} characters.`;
  if (f.documents > CHAT_DOCUMENTS_MAX) return `Link at most ${CHAT_DOCUMENTS_MAX} documents.`;
  return '';
}

interface StepRow {
  id: number;
  text: string;
  on: boolean;
  who: string;
}

/**
 * Save a chat to a project: Claude drafts a summary, the person checks and edits every part, and Save writes it as a
 * `chat` update. Nothing is saved before Save. Afterwards the next steps can become to-dos, one at a time.
 */
export function SaveToProject({ chat, title, project, onSaved, onClose }: SaveToProjectProps) {
  const id = useId();
  const { boot, todos, changeTodos, openPast } = useStore();
  const { list } = useProjects();
  const change = useProjectChange({ reloadOnChanged: true });
  const card = list?.projects.find((p) => p.key === project) ?? null;
  const personal = card ? card.space === 'personal' : project.startsWith('personal/');
  const me = boot?.identity.slug ?? '';

  const [phase, setPhase] = useState<'loading' | 'error' | 'review' | 'saved'>('loading');
  const [errorText, setErrorText] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<ChatSummaryDraft | null>(null);
  const [objective, setObjective] = useState('');
  const [outcome, setOutcome] = useState('');
  const [figures, setFigures] = useState('');
  const [steps, setSteps] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [clientSafe, setClientSafe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [asking, setAsking] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const live = useRef(true);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the request on Try again.
  useEffect(() => {
    let current = true;
    setPhase('loading');
    requestDraft(chat, project).then(
      (d) => {
        if (!current) return;
        setDraft(d);
        setObjective(d.fields.objective);
        setOutcome(d.fields.outcome);
        setFigures(d.fields.figures.join('\n'));
        setSteps(d.fields.nextSteps.join('\n'));
        setPicked(
          new Set(
            d.documents
              .filter((x) => x.picked && !(x.ref.startsWith('personal/') && !personal))
              .map((x) => x.ref),
          ),
        );
        setPhase('review');
      },
      (err: unknown) => {
        if (!current) return;
        setErrorText(failureWords(err));
        setPhase('error');
      },
    );
    return () => {
      current = false;
    };
  }, [chat, project, personal, attempt]);

  const dirty =
    phase === 'review' &&
    draft !== null &&
    (objective !== draft.fields.objective ||
      outcome !== draft.fields.outcome ||
      figures !== draft.fields.figures.join('\n') ||
      steps !== draft.fields.nextSteps.join('\n') ||
      clientSafe ||
      draft.documents.some((d) => d.picked !== picked.has(d.ref)));
  const leave = useSheetHold(dirty);
  const keepFocus = useKeepFocus();

  const cancel = () => {
    if (busy) return;
    if (leave.asking) leave.keep();
    if (dirty) setAsking(true);
    else onClose(false);
  };

  const figureList = lines(figures);
  const stepList = lines(steps);
  const documents: ChatSummaryDoc[] = (draft?.documents ?? [])
    .filter((d) => picked.has(d.ref))
    .map((d) => ({ ref: d.ref, name: d.name }));
  const blocker = saveBlocker({
    objective,
    outcome,
    figures: figureList,
    nextSteps: stepList,
    documents: documents.length,
  });

  // The to-dos step.
  const [rows, setRows] = useState<StepRow[]>([]);
  const [added, setAdded] = useState('');
  const [todoBusy, setTodoBusy] = useState(false);
  const [todoFailed, setTodoFailed] = useState<string[]>([]);
  const canTodos =
    todos?.changes === 'on' &&
    todos.canProject === true &&
    (!personal || todos.canUsePersonal === true) &&
    card !== null &&
    !card.archived;
  const team: TeamMember[] = (() => {
    const all = todos?.team ?? [];
    const first = [card?.owner, ...(card?.team ?? [])].filter((p): p is string => !!p);
    const order = (m: TeamMember) => {
      const i = first.indexOf(m.slug);
      return i === -1 ? first.length : i;
    };
    return [...all].sort((a, b) => order(a) - order(b));
  })();

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !draft) return;
    if (blocker) {
      setMessage(blocker);
      return;
    }
    setBusy(true);
    setMessage('');
    const body = composeChatSummary({
      objective: objective.trim(),
      outcome: outcome.trim(),
      figures: figureList,
      documents,
      nextSteps: stepList,
    });
    const res = await change({
      kind: 'update',
      key: project,
      entry: {
        kind: 'chat',
        summary: body,
        clientSafe,
        chat: draft.chat,
        title: writableChatTitle(draft.title || title),
      },
    });
    if (!live.current) return;
    setBusy(false);
    if (!res.ok) {
      setMessage(res.message);
      return;
    }
    leave.discard();
    onSaved?.();
    setRows(stepList.map((text, i) => ({ id: i, text, on: false, who: me })));
    setPhase('saved');
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  const addTodos = async () => {
    const chosen = rows.filter((r) => r.on && r.text.trim());
    if (chosen.length === 0 || todoBusy) return;
    setTodoBusy(true);
    setAdded('');
    const failed: StepRow[] = [];
    let ok = 0;
    for (const r of chosen) {
      const res = await changeTodos([
        {
          kind: 'add',
          title: r.text.trim().slice(0, CHAT_NEXT_STEP_MAX),
          due: null,
          assignee: personal ? me : r.who || null,
          ...(personal ? { scope: 'personal' as const } : {}),
          ...(todos?.canAttach ? { details: `From the chat summary saved on ${todayWords()}.` } : {}),
          client: card?.client ?? null,
          project,
        },
      ]);
      if (!live.current) return;
      if (res.error) failed.push(r);
      else ok += 1;
    }
    setTodoBusy(false);
    setRows((prev) => prev.filter((r) => !chosen.includes(r) || failed.includes(r)).map((r) => ({ ...r })));
    setTodoFailed(failed.map((r) => r.text));
    setAdded(ok === 1 ? 'Added 1 to-do.' : `Added ${ok} to-dos.`);
  };

  const openChat = async () => {
    setOpenFailed(false);
    const opened = await openPast(chat, { in: 'drawer' });
    if (live.current && !opened) setOpenFailed(true);
  };

  if (phase === 'loading')
    return (
      <section className="card proj-card proj-form proj-save-form" aria-label="Save this chat to a project">
        <StateNote kind="loading">Claude is writing a summary…</StateNote>
        <div className="proj-buttons">
          <button type="button" className="btn" onClick={() => onClose(false)}>
            Cancel
          </button>
        </div>
      </section>
    );

  if (phase === 'error')
    return (
      <section className="card proj-card proj-form proj-save-form" aria-label="Save this chat to a project">
        <StateNote kind="error" onRetry={() => setAttempt((n) => n + 1)}>
          {errorText}
        </StateNote>
        <div className="proj-buttons">
          <button type="button" className="btn" onClick={() => onClose(false)}>
            Cancel
          </button>
        </div>
      </section>
    );

  if (phase === 'saved') {
    const ticked = rows.filter((r) => r.on).length;
    return (
      <section className="card proj-card proj-form proj-save-form" aria-label="Chat saved">
        <h3 ref={headingRef} tabIndex={-1}>
          Saved
        </h3>
        <p className="note">It's on the Updates tab below.</p>
        {rows.length > 0 && canTodos ? (
          <fieldset className="proj-checks proj-save-steps">
            <legend className="label">Make to-dos from the next steps?</legend>
            {rows.map((r) => (
              <div className="proj-save-step" key={r.id}>
                <label className="tick-hit">
                  <input
                    type="checkbox"
                    className="tick"
                    aria-label={`Make a to-do: ${r.text}`}
                    checked={r.on}
                    onChange={(e) =>
                      setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, on: e.target.checked } : x)))
                    }
                  />
                </label>
                <input
                  type="text"
                  className="field"
                  aria-label={`To-do title for step ${r.id + 1}`}
                  maxLength={CHAT_NEXT_STEP_MAX}
                  value={r.text}
                  onChange={(e) =>
                    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, text: e.target.value } : x)))
                  }
                />
                {personal ? null : (
                  <Assignee
                    id={`${id}-who-${r.id}`}
                    value={r.who}
                    onChange={(v) =>
                      setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, who: v } : x)))
                    }
                    me={me}
                    team={team}
                    allowOpen={false}
                  />
                )}
              </div>
            ))}
          </fieldset>
        ) : null}
        <p className="note" role="status">
          {added}
        </p>
        {todoFailed.length > 0 ? (
          <p className="error" role="alert">
            {todoFailed.length === 1 ? "This one wasn't added" : "These weren't added"}:{' '}
            {todoFailed.join('; ')}.
          </p>
        ) : null}
        <div className="proj-buttons">
          {rows.length > 0 && canTodos ? (
            <button
              type="button"
              className="btn"
              data-variant="primary"
              aria-disabled={ticked === 0 || todoBusy || undefined}
              onClick={() => void addTodos()}
            >
              Add to-dos
            </button>
          ) : null}
          <button type="button" className="btn" onClick={() => onClose(true)}>
            Done
          </button>
        </div>
      </section>
    );
  }

  const fieldError = (over: boolean, max: number) =>
    over ? (
      <p className="error" id={`${id}-over-${max}`}>
        Too long. Keep it under {max} characters.
      </p>
    ) : null;

  return (
    <form
      className="card proj-card proj-form proj-save-form"
      aria-label="Save this chat to a project"
      onSubmit={(e) => void save(e)}
      onFocus={keepFocus.track}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        e.preventDefault();
        e.stopPropagation();
        if (leave.asking) {
          leave.keep();
          keepFocus.restore();
        } else if (asking) {
          setAsking(false);
          keepFocus.restore();
        } else cancel();
      }}
    >
      {asking || leave.asking ? (
        <Confirm
          label="Discard your changes"
          text="Discard your changes?"
          action="Discard changes"
          safe="Keep editing"
          variant="danger"
          busy={false}
          key={leave.asking ? 'leave' : 'cancel'}
          onConfirm={() => {
            if (leave.asking) leave.discard();
            onClose(false);
          }}
          onCancel={() => {
            if (leave.asking) leave.keep();
            setAsking(false);
            keepFocus.restore();
          }}
        />
      ) : null}
      <p className="note">
        Nothing is saved until you press Save to project. Only what you see here is saved, never the chat
        itself.{' '}
        <button type="button" className="link-btn" onClick={() => void openChat()}>
          Open chat
        </button>
        {openFailed ? <span className="error"> The chat can't be opened.</span> : null}
      </p>
      {draft?.fromEmail ? (
        <p className="notice" data-level="warn" data-shape="box" role="status">
          Some of this came from your email. Saving it here is your OK for exactly this text.
        </p>
      ) : null}
      {draft && draft.earlier.length > 0 ? (
        <p className="notice" data-level="info" data-shape="box" role="status">
          You saved this chat on {dateWords(draft.earlier[0]?.at ?? null)}. This summary covers what's
          happened since.
        </p>
      ) : null}
      {draft?.nothingNew ? (
        <p className="notice" data-level="info" data-shape="box" role="status">
          Claude found nothing new in this chat since then. You can still save a summary.
        </p>
      ) : null}
      <div className="form-field">
        <label htmlFor={`${id}-objective`}>Objective</label>
        <textarea
          id={`${id}-objective`}
          className="field proj-area"
          rows={2}
          value={objective}
          aria-invalid={objective.trim().length > CHAT_OBJECTIVE_MAX ? true : undefined}
          onChange={(e) => setObjective(e.target.value)}
          // biome-ignore lint/a11y/noAutofocus: the person just pressed Save to project.
          autoFocus
        />
        {fieldError(objective.trim().length > CHAT_OBJECTIVE_MAX, CHAT_OBJECTIVE_MAX)}
      </div>
      <div className="form-field">
        <label htmlFor={`${id}-outcome`}>Outcome</label>
        <textarea
          id={`${id}-outcome`}
          className="field proj-area"
          rows={4}
          value={outcome}
          aria-invalid={outcome.trim().length > CHAT_OUTCOME_MAX ? true : undefined}
          onChange={(e) => setOutcome(e.target.value)}
        />
        {fieldError(outcome.trim().length > CHAT_OUTCOME_MAX, CHAT_OUTCOME_MAX)}
      </div>
      <div className="form-field">
        <label htmlFor={`${id}-figures`}>Key figures</label>
        <textarea
          id={`${id}-figures`}
          className="field proj-area"
          rows={3}
          aria-describedby={`${id}-figures-hint`}
          value={figures}
          onChange={(e) => setFigures(e.target.value)}
        />
        <p className="hint" id={`${id}-figures-hint`}>
          One per line, with its unit.
        </p>
      </div>
      {draft && draft.documents.length > 0 ? (
        <fieldset className="proj-checks proj-save-docs">
          <legend className="label">Documents to link</legend>
          {draft.documents.map((d) => {
            const blocked = d.ref.startsWith('personal/') && !personal;
            return (
              <label className="proj-check" key={d.ref}>
                <input
                  type="checkbox"
                  className="tick"
                  checked={picked.has(d.ref)}
                  disabled={blocked}
                  onChange={(e) =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(d.ref);
                      else next.delete(d.ref);
                      return next;
                    })
                  }
                />
                {d.name}
                {blocked ? <span className="proj-note"> Only on your Mac</span> : null}
              </label>
            );
          })}
        </fieldset>
      ) : null}
      <div className="form-field">
        <label htmlFor={`${id}-steps`}>Next steps</label>
        <textarea
          id={`${id}-steps`}
          className="field proj-area"
          rows={3}
          aria-describedby={`${id}-steps-hint`}
          value={steps}
          onChange={(e) => setSteps(e.target.value)}
        />
        <p className="hint" id={`${id}-steps-hint`}>
          One per line. After saving you can turn them into to-dos.
        </p>
      </div>
      <label className="proj-check">
        <input
          type="checkbox"
          className="tick"
          checked={clientSafe}
          onChange={(e) => setClientSafe(e.target.checked)}
        />
        Fine to share with the client
      </label>
      <p className="hint" role="status">
        {blocker}
      </p>
      {message ? (
        <p className="error" role="alert">
          {message}
        </p>
      ) : null}
      <div className="proj-buttons">
        <button
          type="submit"
          className="btn"
          data-variant="primary"
          aria-disabled={busy || blocker !== '' || undefined}
        >
          Save to project
        </button>
        <button type="button" className="btn" aria-disabled={busy || undefined} onClick={cancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
