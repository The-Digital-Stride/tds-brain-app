import { type FormEvent, useId, useState } from 'react';
import {
  EMAIL_NAME_MAX,
  EMAIL_SUBJECT_MAX,
  type EmailDraftItem,
  type EmailRouteWhy,
} from '../../../../shared/project-email-contract.ts';
import { UPDATE_SUMMARY_MAX } from '../../../../shared/project-updates-contract.ts';
import { ApiFailure, api } from '../../api.ts';
import { Confirm } from '../../shell/Confirm.tsx';
import { useSheetHold } from '../../shell/useSheetHold.ts';
import { dateWords } from './logic.ts';
import { useKeepFocus } from './useKeepFocus.ts';

/** One live project the email can be saved to. */
export interface EmailProjectOption {
  key: string;
  label: string;
}

/** The one-line reason for the pre-selected project (or for none), in plain words. */
export function routeWords(route: EmailDraftItem['route']): string {
  const why: EmailRouteWhy = route.why;
  switch (why) {
    case 'requested':
      return 'You asked for this project.';
    case 'thread':
      return 'This email thread is already linked to this project.';
    case 'message':
      return 'Another email in this thread is already in this project.';
    case 'subject-code':
      return 'The project code is in the subject.';
    case 'body-code':
      return 'The project code is in the email.';
    case 'domain':
      return "The sender's company has only this project.";
    case 'codes-disagree':
      return `The email has codes for different projects: ${(route.codes ?? []).join(', ')}. Choose one.`;
    case 'domain-several':
      return "The sender's company has more than one project. Choose one.";
    default:
      return 'No project matched this email. Choose one.';
  }
}

export type ApprovalResult =
  | { done: 'saved'; key: string }
  | { done: 'dismissed' }
  | { done: 'exists'; key: string | null; byName: string | null }
  | { done: 'cancelled' };

/**
 * The approval form for one waiting email: pick the project, edit exactly what will be saved, then "Save to project"
 * or "Not for a project". Nothing from the email reaches a project until Save.
 */
export function EmailApproval({
  draft,
  projects,
  onDone,
}: {
  draft: EmailDraftItem;
  projects: readonly EmailProjectOption[];
  onDone: (result: ApprovalResult) => void;
}) {
  const id = useId();
  const [project, setProject] = useState(draft.route.key ?? '');
  const [subject, setSubject] = useState(draft.subject);
  const [from, setFrom] = useState(draft.from);
  const [people, setPeople] = useState(draft.people.join('\n'));
  const [summary, setSummary] = useState(draft.summary);
  const [clientSafe, setClientSafe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [asking, setAsking] = useState(false);
  const dirty =
    project !== (draft.route.key ?? '') ||
    subject !== draft.subject ||
    from !== draft.from ||
    people !== draft.people.join('\n') ||
    summary !== draft.summary ||
    clientSafe;
  const leave = useSheetHold(dirty);
  const keepFocus = useKeepFocus();

  const cancel = () => {
    if (busy) return;
    if (leave.asking) leave.keep();
    if (dirty) setAsking(true);
    else onDone({ done: 'cancelled' });
  };

  const fail = (err: unknown) => {
    setMessage(err instanceof ApiFailure ? err.message : 'Something went wrong. Please try again.');
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    // One name per line, so a name written "Smith, Alex" stays one person (correctness review).
    const names = people
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean);
    if ([from, ...names].some((n) => n.includes('@'))) {
      setMessage("Use people's names, not email addresses.");
      return;
    }
    if (!project) {
      // UX review: say why Save did nothing.
      setMessage('Choose a project first.');
      document.getElementById(`${id}-project`)?.focus();
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const res = await api.projectEmailDraftAct({
        action: 'approve',
        id: draft.id,
        key: project,
        summary: summary.trim(),
        subject: subject.trim(),
        from: from.trim(),
        people: names,
        clientSafe,
      });
      if (res.ok) {
        leave.discard();
        onDone({ done: 'saved', key: project });
      } else if (res.code === 'exists') {
        leave.discard();
        onDone({ done: 'exists', key: res.key ?? null, byName: res.byName ?? null });
      } else setMessage('That email could not be saved. Please try again.');
    } catch (err) {
      // A server that answers `exists` as an error still means the email is in a project already.
      if (err instanceof ApiFailure && (err.code as string) === 'exists') {
        leave.discard();
        onDone({ done: 'exists', key: null, byName: null });
      } else fail(err);
    }
    setBusy(false);
  };

  const dismiss = async () => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await api.projectEmailDraftAct({ action: 'dismiss', id: draft.id });
      leave.discard();
      onDone({ done: 'dismissed' });
    } catch (err) {
      fail(err);
    }
    setBusy(false);
  };

  return (
    <form
      className="card proj-card proj-form proj-email-form"
      aria-label="Save this email to a project"
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
            onDone({ done: 'cancelled' });
          }}
          onCancel={() => {
            if (leave.asking) leave.keep();
            setAsking(false);
            keepFocus.restore();
          }}
        />
      ) : null}
      <p className="proj-note">
        Nothing is saved until you press Save to project. Only what you see here is saved, never the email
        itself.
      </p>
      <div className="form-field">
        <label htmlFor={`${id}-project`}>Project</label>
        <select
          id={`${id}-project`}
          className="field"
          value={project}
          aria-describedby={`${id}-why`}
          onChange={(e) => setProject(e.target.value)}
          // biome-ignore lint/a11y/noAutofocus: the person just opened this email.
          autoFocus
        >
          <option value="">Choose a project</option>
          {projects.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        <p className="proj-note" id={`${id}-why`}>
          {/* The reason only describes the project the app suggested (UX review). */}
          {project === (draft.route.key ?? '') ? routeWords(draft.route) : 'You chose this project.'}
        </p>
      </div>
      <div className="form-field">
        <label htmlFor={`${id}-subject`}>Subject</label>
        <input
          id={`${id}-subject`}
          className="field"
          type="text"
          autoComplete="off"
          maxLength={EMAIL_SUBJECT_MAX}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
      </div>
      <div className="form-field">
        <label htmlFor={`${id}-from`}>From</label>
        <input
          id={`${id}-from`}
          className="field"
          type="text"
          autoComplete="off"
          maxLength={EMAIL_NAME_MAX}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </div>
      <div className="form-field">
        <label htmlFor={`${id}-people`}>Who else was on it</label>
        <textarea
          id={`${id}-people`}
          className="field proj-area"
          rows={Math.min(6, Math.max(2, draft.people.length))}
          aria-describedby={`${id}-people-hint`}
          value={people}
          onChange={(e) => setPeople(e.target.value)}
        />
        <p className="proj-note" id={`${id}-people-hint`}>
          One name per line. Email addresses are never saved.
        </p>
      </div>
      <div className="form-field">
        <label htmlFor={`${id}-summary`}>Summary</label>
        <textarea
          id={`${id}-summary`}
          className="field proj-area"
          rows={4}
          maxLength={UPDATE_SUMMARY_MAX}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
      </div>
      <p className="proj-note">Sent {dateWords(draft.sentAt)}. This date is saved too.</p>
      <label className="proj-check">
        <input
          type="checkbox"
          className="tick"
          checked={clientSafe}
          onChange={(e) => setClientSafe(e.target.checked)}
        />
        Client can see this
      </label>
      {message ? (
        <p className="error" role="alert">
          {message}
        </p>
      ) : null}
      <div className="proj-buttons">
        <button type="submit" className="btn" data-variant="primary" aria-disabled={busy || undefined}>
          Save to project
        </button>
        <button
          type="button"
          className="btn"
          aria-disabled={busy || undefined}
          onClick={() => void dismiss()}
        >
          Not for a project
        </button>
        <button
          type="button"
          className="btn"
          data-variant="quiet"
          aria-disabled={busy || undefined}
          onClick={cancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
