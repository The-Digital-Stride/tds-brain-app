import { useEffect, useRef, useState } from 'react';
import type {
  AskQuestion,
  ChangeLine,
  PermissionDecision,
  ProposedChange,
  QuestionReply,
} from '../../../shared/contract.ts';
import { api } from '../api.ts';
import { Icon } from '../shell/Icon.tsx';
import type { Outcome, PermissionItem, QuestionItem } from '../state/chat-reducer.ts';
import { useStore } from '../store.tsx';

function useFocusOnAppear<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (active) ref.current?.focus();
  }, [active]);
  return ref;
}

const OUTCOME_WORDS: Record<Outcome, string> = {
  allowed: 'You allowed this',
  denied: 'You said no to this',
  answered: 'You answered',
  cancelled: 'This was cancelled',
};

/** The sign shown before an edit's line, and the words a screen reader hears instead of the colour. */
const LINE_MARKS: Record<'same' | 'removed' | 'added', { sign: string; words: string }> = {
  same: { sign: ' ', words: '' },
  removed: { sign: '−', words: 'Removed: ' },
  added: { sign: '+', words: 'Added: ' },
};

const CUT_TEXT = "The rest isn't shown because the change is too long.";

/** `plain`: a new or replacing file, where every line is new, so no signs or "Added:" words. */
function DiffLine({ line, plain }: { line: ChangeLine; plain: boolean }) {
  if (line.kind === 'gap') {
    return (
      <span className="diff-gap">
        {line.count === 1 ? '1 unchanged line' : `${line.count.toLocaleString('en-GB')} unchanged lines`}
      </span>
    );
  }
  if (line.kind === 'cut') return <span className="diff-gap diff-cut">{CUT_TEXT}</span>;
  if (plain) {
    return (
      <span className="diff-line" data-kind="plain">
        {line.text}
      </span>
    );
  }
  const mark = LINE_MARKS[line.kind];
  return (
    <span className="diff-line" data-kind={line.kind}>
      <span className="diff-sign" aria-hidden="true">
        {mark.sign}
      </span>
      {mark.words ? <span className="visually-hidden">{mark.words}</span> : null}
      {line.text}
    </span>
  );
}

function lines(n: number): string {
  return n === 1 ? '1 line' : `${n.toLocaleString('en-GB')} lines`;
}

/** The one line shown while the change is closed: what it is, and how much changes. */
export function changeSummary(change: ProposedChange): string {
  let removed = 0;
  let added = 0;
  let cut = false;
  for (const p of change.parts) {
    for (const l of p.lines) {
      if (l.kind === 'removed') removed++;
      else if (l.kind === 'added') added++;
      else if (l.kind === 'cut') cut = true;
    }
  }
  if (change.kind === 'edit') {
    const many = change.parts.length > 1;
    const edits = many ? `The change (${change.parts.length} edits)` : 'The change';
    // Counts of a cut change would understate it; the card's warning gives the real size.
    let counts: string;
    if (cut) counts = ', too long to show in full';
    else if (removed > 0 && added > 0)
      counts = `: ${lines(removed)} removed, ${added.toLocaleString('en-GB')} added`;
    else if (removed > 0) counts = `: ${lines(removed)} removed`;
    else counts = `: ${lines(added)} added`;
    // Never hidden behind the fold: one line on the card can stand for every place it appears.
    let everywhere = '';
    if (change.parts.some((p) => p.everyMatch))
      everywhere = many
        ? ', some made everywhere they appear in the file'
        : ', everywhere it appears in the file';
    return `${edits}${counts}${everywhere}`;
  }
  const lead = change.kind === 'new-file' ? 'What the new file will contain' : 'Replaces the whole file';
  if (cut) return `${lead}, too long to show in full`;
  return change.kind === 'new-file' ? `${lead}: ${lines(added)}` : `${lead} with ${lines(added)}`;
}

const EMPTY_WORDS: Record<ProposedChange['kind'], string> = {
  edit: 'No lines change.',
  'new-file': 'The new file will be empty.',
  'replace-file': 'This empties the whole file.',
};

/**
 * What a Write or Edit will do, closed to one line that says how much changes; opening it shows
 * the lines. Plain text only, never markdown or HTML. Warnings stay on the card, outside it.
 */
export function ChangeView({ change }: { change: ProposedChange }) {
  const isEdit = change.kind === 'edit';
  const many = change.parts.length > 1;
  if (change.parts.every((p) => p.lines.length === 0)) {
    return <p className="change-empty">{EMPTY_WORDS[change.kind]}</p>;
  }
  return (
    <details className="activity change-fold">
      <summary>
        <Icon name="chevron" size={14} />
        {changeSummary(change)}
      </summary>
      {isEdit ? <p className="change-key">Lines marked − are removed and lines marked + are added.</p> : null}
      <section
        className="approval-detail approval-change"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling box must be reachable by keyboard.
        tabIndex={0}
        aria-label={isEdit ? 'The change' : 'The new contents'}
      >
        {change.parts.map((part, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder; their place is their identity.
          <div className="diff-part" key={i}>
            {many || part.everyMatch ? (
              <p className="diff-part-head">
                {many ? `Change ${i + 1} of ${change.parts.length}` : null}
                {many && part.everyMatch ? ' · ' : null}
                {part.everyMatch
                  ? 'Claude will make this change everywhere it appears in the file, not just the first time.'
                  : null}
              </p>
            ) : null}
            <pre>
              <code>
                {part.lines.map((line, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: lines never reorder; their place is their identity.
                  <DiffLine key={j} line={line} plain={!isEdit} />
                ))}
              </code>
            </pre>
          </div>
        ))}
      </section>
    </details>
  );
}

interface CardProps<T> {
  item: T;
  sessionId: string;
  /**
   * Called once the answer has gone through. The chat's floater uses it to keep focus off the
   * message box while another card is waiting; on its own, a card sends focus to the message box.
   */
  onAnswered?: () => void;
}

export function PermissionCard({ item, sessionId, onAnswered }: CardProps<PermissionItem>) {
  const { run, requestComposerFocus } = useStore();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useFocusOnAppear<HTMLElement>(item.outcome === null);

  if (item.outcome !== null) {
    return (
      <p className="record">
        {OUTCOME_WORDS[item.outcome]}: {item.title}
      </p>
    );
  }

  const decide = async (decision: PermissionDecision) => {
    setBusy(true);
    const ok = await run(() =>
      api.answerPermission(sessionId, {
        requestId: item.requestId,
        decision,
        ...(decision === 'deny' && note.trim() ? { note: note.trim() } : {}),
      }),
    );
    if (ok) (onAnswered ?? requestComposerFocus)();
    else setBusy(false);
  };

  const titleId = `perm-${item.requestId}-title`;
  const detailId = `perm-${item.requestId}-detail`;
  const whyId = `perm-${item.requestId}-why`;
  return (
    <section className="approval" aria-labelledby={titleId} tabIndex={-1} ref={ref}>
      <div className="approval-tag">Needs your approval</div>
      <div className="approval-title" id={titleId}>
        {item.title}
      </div>
      {item.detail ? (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling box must be reachable by keyboard.
        <section className="approval-detail" tabIndex={0} aria-labelledby={detailId}>
          <span className="visually-hidden" id={detailId}>
            Full details of what Claude wants to do
          </span>
          <pre>
            <code>{item.detail}</code>
          </pre>
        </section>
      ) : null}
      {item.change ? <ChangeView change={item.change} /> : null}
      {item.warning ? (
        <p className="approval-warning">
          <strong>Take care: </strong>
          {item.warning}
        </p>
      ) : null}
      <label className="note-field">
        <span>If you say no, tell Claude why (optional)</span>
        <input
          className="field"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={busy}
          maxLength={500}
        />
      </label>
      <div className="answer-actions">
        <button
          type="button"
          className="btn"
          data-variant="primary"
          disabled={busy}
          onClick={() => void decide('allow')}
        >
          Allow
        </button>
        {item.sessionAllowLabel !== null ? (
          <button
            type="button"
            className="btn"
            disabled={busy}
            aria-describedby={whyId}
            onClick={() => void decide('allow-session')}
          >
            Allow for this chat
          </button>
        ) : null}
        <button type="button" className="btn" disabled={busy} onClick={() => void decide('deny')}>
          Don't allow
        </button>
      </div>
      {item.sessionAllowLabel !== null ? (
        <p className="why" id={whyId}>
          {item.sessionAllowLabel}
        </p>
      ) : null}
    </section>
  );
}

interface Pick {
  chosen: string[];
  own: string;
}

/** What goes to the engine for one question: own words win for a single choice; multi adds them. */
export function answerFor(q: AskQuestion, pick: Pick | undefined): string | string[] | null {
  const own = pick?.own.trim() ?? '';
  const chosen = pick?.chosen ?? [];
  if (q.multiSelect) {
    const all = own ? [...chosen, own] : chosen;
    return all.length > 0 ? all : null;
  }
  if (own) return own;
  return chosen[0] ?? null;
}

export function QuestionCard({ item, sessionId, onAnswered }: CardProps<QuestionItem>) {
  const { run, requestComposerFocus } = useStore();
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [busy, setBusy] = useState(false);
  const ref = useFocusOnAppear<HTMLFormElement>(item.outcome === null);

  if (item.outcome !== null) {
    return (
      <p className="record">
        {item.outcome === 'answered' ? 'You answered Claude’s question' : OUTCOME_WORDS[item.outcome]}.
      </p>
    );
  }

  const update = (q: string, fn: (p: Pick) => Pick) =>
    setPicks((all) => ({ ...all, [q]: fn(all[q] ?? { chosen: [], own: '' }) }));

  const toggle = (q: AskQuestion, label: string) =>
    update(q.question, (p) => {
      if (q.multiSelect) {
        return {
          ...p,
          chosen: p.chosen.includes(label) ? p.chosen.filter((c) => c !== label) : [...p.chosen, label],
        };
      }
      return { chosen: [label], own: '' };
    });

  const answers: Record<string, string | string[]> = {};
  let complete = item.questions.length > 0;
  for (const q of item.questions) {
    const a = answerFor(q, picks[q.question]);
    if (a === null) complete = false;
    else answers[q.question] = a;
  }

  const send = async () => {
    setBusy(true);
    const reply: QuestionReply = { requestId: item.requestId, answers };
    const ok = await run(() => api.answerQuestion(sessionId, reply));
    if (ok) (onAnswered ?? requestComposerFocus)();
    else setBusy(false);
  };

  return (
    <form
      className="question-card"
      aria-label="Claude has a question for you"
      tabIndex={-1}
      ref={ref}
      onSubmit={(e) => {
        e.preventDefault();
        if (complete && !busy) void send();
      }}
    >
      {item.questions.map((q, qi) => {
        const pick = picks[q.question];
        const ownId = `q-${item.requestId}-${qi}-own`;
        const group = `q-${item.requestId}-${qi}`;
        return (
          <fieldset key={q.question}>
            <legend>
              {q.header ? <span className="q-header">{q.header}</span> : null}
              {q.question}
            </legend>
            {q.multiSelect ? <span className="meta">Choose as many as you like.</span> : null}
            {q.options.map((o) => (
              <label key={o.label} className="opt">
                <input
                  className="tick"
                  type={q.multiSelect ? 'checkbox' : 'radio'}
                  name={group}
                  checked={pick?.chosen.includes(o.label) ?? false}
                  disabled={busy}
                  onChange={() => toggle(q, o.label)}
                />
                <span>
                  <span className="opt-label">{o.label}</span>
                  {o.description ? <span className="opt-desc">{o.description}</span> : null}
                </span>
              </label>
            ))}
            <label className="own-answer" htmlFor={ownId}>
              <span>Or type your own answer</span>
              <input
                id={ownId}
                className="field"
                value={pick?.own ?? ''}
                disabled={busy}
                onChange={(e) =>
                  update(q.question, (p) => ({
                    chosen: q.multiSelect ? p.chosen : e.target.value ? [] : p.chosen,
                    own: e.target.value,
                  }))
                }
              />
            </label>
          </fieldset>
        );
      })}
      <div className="answer-actions">
        <button type="submit" className="btn" data-variant="primary" disabled={!complete || busy}>
          Send answer
        </button>
      </div>
    </form>
  );
}
