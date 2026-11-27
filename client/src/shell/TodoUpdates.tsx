import { type FormEvent, type KeyboardEvent, type ReactNode, useId, useRef, useState } from 'react';
import type { TeamMember } from '../../../shared/contract.ts';
import { entryKey } from '../../../shared/todo-changes.ts';
import {
  TODO_LINK_URL_MAX,
  TODO_UPDATE_MAX,
  type TodoUpdate,
} from '../../../shared/todo-updates-contract.ts';
import { handoverEntryLine, updateWhen, updateWhenFull } from './words.ts';

/** The count shows once the text is this close to the limit. */
const COUNT_FROM = TODO_UPDATE_MAX - 200;

/** Splits a line into text and http(s) links. Plain text everywhere else: no HTML, no markdown. */
function linkify(line: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /https?:\/\/[^\s<>"']+/gi;
  let last = 0;
  let n = 0;
  for (const m of line.matchAll(re)) {
    let url = m[0];
    // A link longer than the script would ever write stays text: the trim below re-reads the whole match on
    // each pass, so a hand-edited line of a million brackets would freeze the tab (security review).
    if (url.length > TODO_LINK_URL_MAX) continue;
    // Sentence punctuation after the link is not part of it; a closing bracket only when nothing opened it.
    while (/[.,;:!?]$/.test(url) || (url.endsWith(')') && !url.includes('('))) url = url.slice(0, -1);
    let safe = false;
    try {
      const parsed = new URL(url);
      safe = (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host !== '';
    } catch {
      safe = false;
    }
    if (!safe) continue;
    const start = m.index ?? 0;
    if (start > last) out.push(line.slice(last, start));
    out.push(
      <a key={`${keyBase}-${n++}`} href={url} target="_blank" rel="noopener noreferrer">
        {url}
        <span className="visually-hidden"> (opens in a new tab)</span>
      </a>,
    );
    last = start + url.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

/** A note's text: lines kept, links made, nothing else interpreted. */
function NoteText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <p className="todo-update-text">
      {lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines of one note never reorder.
        <span key={i}>
          {i > 0 ? <br /> : null}
          {linkify(line, String(i))}
        </span>
      ))}
    </p>
  );
}

function When({ at }: { at: string }) {
  const text = updateWhen(at);
  return text ? (
    <time className="todo-update-when" dateTime={at} title={updateWhenFull(at)}>
      {text}
    </time>
  ) : null;
}

/** What the box needs to add an update. Null for a read-only list. */
export interface TodoUpdateCompose {
  /** The text typed so far (kept by the panel, so it survives a switch to editing and is asked about on close). */
  text: string;
  setText: (text: string) => void;
  /** A change is running: the buttons wait. */
  busy: boolean;
  /** This person can mark the task as done: offers "Add update and mark as done". */
  canDone: boolean;
  /** Sends the update. True when it went (or, with `markDone`, was held with an Undo). */
  onAdd: (text: string, markDone: boolean) => Promise<boolean>;
}

const MINUTE_MS = 60_000;
const minuteOf = (iso: string): number => Math.floor(Date.parse(iso) / MINUTE_MS);

/** One card in the list: an entry, or a handover with the note written with it (shown as one). */
interface UpdateCard {
  entry: TodoUpdate;
  /** The note that went with a handover: same person, same minute. */
  note?: TodoUpdate;
}

/**
 * Newest first. A hand back or pass-on and the note sent with it (same name, same minute) show as one card: the
 * handover line as the heading, the note under it. Display only: the file and every count are unchanged.
 */
function toCards(updates: readonly TodoUpdate[]): UpdateCard[] {
  const paired = new Set<TodoUpdate>();
  const noteFor = new Map<TodoUpdate, TodoUpdate>();
  for (const h of updates) {
    if (h.kind !== 'handover' || !h.byName) continue;
    const n = updates.find(
      (e) =>
        e.kind === 'note' &&
        !paired.has(e) &&
        e.byName === h.byName &&
        !Number.isNaN(minuteOf(e.at)) &&
        minuteOf(e.at) === minuteOf(h.at),
    );
    if (n) {
      paired.add(n);
      noteFor.set(h, n);
    }
  }
  const cards: UpdateCard[] = [];
  for (const e of [...updates].reverse()) {
    if (paired.has(e)) continue;
    const note = noteFor.get(e);
    cards.push(note ? { entry: e, note } : { entry: e });
  }
  return cards;
}

function NewTag() {
  return <span className="badge">New</span>;
}

export interface TodoUpdatesProps {
  /** Oldest first, as the server sends them. */
  updates?: TodoUpdate[];
  /** Older entries were left out. */
  more?: boolean;
  /** Lines in the section that aren't entries. */
  extras?: string[];
  team: readonly TeamMember[];
  /** `entryKey`s of the entries this person had not seen when they opened the task: tagged "New" while it stays open. */
  newKeys?: ReadonlySet<string>;
  compose: TodoUpdateCompose | null;
  onStatus: (text: string, isError?: boolean) => void;
}

/**
 * The Updates block under a task's Files: what happened and what people said, newest first, and a box to add
 * an update for the person holding the task (or the one who asked, while it waits). Plan
 * 2026-11-27-task-updates-handback, decision 12.
 */
export function TodoUpdates({ updates, more, extras, team, newKeys, compose, onStatus }: TodoUpdatesProps) {
  const headId = useId();
  const cards = toCards(updates ?? []);
  const isNew = (e: TodoUpdate): boolean => newKeys?.has(entryKey(e)) === true;
  const newCount = (updates ?? []).filter(isNew).length;
  const lines = extras ?? [];
  if (!compose && cards.length === 0 && lines.length === 0) return null;
  return (
    <section className="todo-updates" aria-labelledby={headId}>
      <h3 className="todo-files-head" id={headId}>
        Updates
      </h3>
      {/* The box sits above the newest-first list, so a new update appears right under it. */}
      {compose ? <AddUpdate compose={compose} onStatus={onStatus} /> : null}
      {cards.length === 0 && lines.length === 0 ? <p className="todo-empty">No updates yet.</p> : null}
      {cards.length > 0 ? (
        <>
          {/* Present before it has words, so a screen reader hears it when it fills. */}
          <p className="todo-update-news" role="status" aria-live="polite">
            {newCount > 0 ? `${newCount} new since you last looked.` : ''}
          </p>
          <ul className="todo-update-list">
            {cards.map(({ entry: e, note }, i) => {
              const merged = note ? 'true' : undefined;
              return e.kind === 'note' ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: entries can share a minute and never reorder.
                <li key={i} className="todo-update" data-kind="note">
                  <p className="todo-update-meta">
                    <span className="todo-update-who">{e.byName || e.by || 'Someone'}</span>
                    <When at={e.at} />
                    {isNew(e) ? <NewTag /> : null}
                  </p>
                  <NoteText text={e.text} />
                </li>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: entries can share a minute and never reorder.
                <li key={i} className="todo-update" data-kind={e.kind} data-merged={merged}>
                  <p className="todo-update-line">
                    {e.byName || e.by || 'Someone'}{' '}
                    {e.kind === 'handover' ? handoverEntryLine(e.byName || e.by || '', e.text, team) : e.text}
                    {updateWhen(e.at) ? <span className="todo-sep"> · </span> : null}
                    <When at={e.at} />
                    {isNew(e) || (note && isNew(note)) ? <NewTag /> : null}
                  </p>
                  {note ? <NoteText text={note.text} /> : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      {more ? <p className="todo-note">Older updates aren't shown.</p> : null}
      {lines.length > 0 ? (
        <ul className="todo-files-extras">
          {lines.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines can repeat and never reorder.
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function AddUpdate({
  compose,
  onStatus,
}: {
  compose: TodoUpdateCompose;
  onStatus: (text: string, isError?: boolean) => void;
}) {
  const uid = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const { text, setText, busy, canDone, onAdd } = compose;
  const empty = text.trim() === '';
  const nearLimit = text.length >= COUNT_FROM;

  // Set before the call and cleared after it, so a second press before the reply sends nothing.
  const sending = useRef(false);
  const [inFlight, setInFlight] = useState(false);
  const off = busy || inFlight;

  const send = async (markDone: boolean) => {
    if (busy || sending.current) return;
    if (empty) {
      onStatus('Write an update first.', true);
      box.current?.focus();
      return;
    }
    sending.current = true;
    setInFlight(true);
    try {
      const ok = await onAdd(text.trim(), markDone);
      if (!ok) return;
      if (!markDone) {
        setText('');
        onStatus('Update added.');
        box.current?.focus({ preventScroll: true });
      }
    } finally {
      sending.current = false;
      setInFlight(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(false);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send(false);
    }
  };
  return (
    <form className="todo-update-form" onSubmit={submit} onKeyDown={onKeyDown}>
      <div className="form-field">
        <label htmlFor={`${uid}-text`}>Add an update</label>
        <textarea
          id={`${uid}-text`}
          ref={box}
          className="field"
          rows={3}
          value={text}
          maxLength={TODO_UPDATE_MAX}
          aria-describedby={nearLimit ? `${uid}-count` : undefined}
          onChange={(e) => setText(e.target.value)}
        />
        {nearLimit ? (
          <p className="hint" id={`${uid}-count`}>
            {text.length.toLocaleString('en-GB')} of {TODO_UPDATE_MAX.toLocaleString('en-GB')} characters
          </p>
        ) : null}
      </div>
      <div className="todo-actions">
        <button
          type="submit"
          className="btn"
          data-size="small"
          aria-disabled={off || undefined}
          onClick={(e) => {
            // aria-disabled keeps focus on the button, so the press itself must do nothing.
            if (off) e.preventDefault();
          }}
        >
          Add an update
        </button>
        {canDone ? (
          <button
            type="button"
            className="btn"
            data-size="small"
            aria-disabled={off || undefined}
            onClick={() => void send(true)}
          >
            Add an update and mark as done
          </button>
        ) : null}
      </div>
    </form>
  );
}
