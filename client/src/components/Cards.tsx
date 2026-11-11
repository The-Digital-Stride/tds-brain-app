import { useEffect, useRef, useState } from 'react';
import type { AskQuestion, PermissionDecision, QuestionReply } from '../../../shared/contract.ts';
import { api } from '../api.ts';
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

export function PermissionCard({ item, sessionId }: { item: PermissionItem; sessionId: string }) {
  const { run } = useStore();
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
    if (!ok) setBusy(false);
  };

  const titleId = `perm-${item.requestId}-title`;
  return (
    <section className="approval" aria-labelledby={titleId} tabIndex={-1} ref={ref}>
      <div className="approval-tag">Needs your approval</div>
      <div className="approval-title" id={titleId}>
        {item.title}
      </div>
      {item.detail ? (
        <pre>
          <code>{item.detail}</code>
        </pre>
      ) : null}
      <div className="approval-actions">
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
          <div className="allow-group">
            <button
              type="button"
              className="btn"
              disabled={busy}
              aria-describedby={`perm-${item.requestId}-why`}
              onClick={() => void decide('allow-session')}
            >
              Allow for this chat
            </button>
            <span className="why" id={`perm-${item.requestId}-why`}>
              {item.sessionAllowLabel}
            </span>
          </div>
        ) : null}
        <button type="button" className="btn" disabled={busy} onClick={() => void decide('deny')}>
          Don't
        </button>
      </div>
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
    </section>
  );
}

interface Pick {
  chosen: string[];
  own: string;
}

function answerFor(q: AskQuestion, pick: Pick | undefined): string | string[] | null {
  const own = pick?.own.trim() ?? '';
  const chosen = pick?.chosen ?? [];
  if (q.multiSelect) {
    const all = own ? [...chosen, own] : chosen;
    return all.length > 0 ? all : null;
  }
  if (own) return own;
  return chosen[0] ?? null;
}

export function QuestionCard({ item, sessionId }: { item: QuestionItem; sessionId: string }) {
  const { run } = useStore();
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
      return { chosen: p.chosen[0] === label ? [] : [label], own: '' };
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
    if (!ok) setBusy(false);
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
        return (
          <fieldset key={q.question}>
            {q.header ? <span className="q-header">{q.header}</span> : null}
            <legend>{q.question}</legend>
            {q.multiSelect ? <span className="meta">Choose as many as you like.</span> : null}
            {q.options.map((o) => (
              <button
                key={o.label}
                type="button"
                className="opt"
                aria-pressed={pick?.chosen.includes(o.label) ?? false}
                disabled={busy}
                onClick={() => toggle(q, o.label)}
              >
                <span className="opt-label">{o.label}</span>
                {o.description ? <span className="opt-desc">{o.description}</span> : null}
              </button>
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
      <div>
        <button type="submit" className="btn" data-variant="primary" disabled={!complete || busy}>
          Send
        </button>
      </div>
    </form>
  );
}
