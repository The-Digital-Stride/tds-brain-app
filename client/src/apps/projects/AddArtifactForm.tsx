import { type FormEvent, useId, useRef, useState } from 'react';
import { cleanArtifactUrl } from '../../../../shared/pages.ts';
import type { ProjectCard } from '../../../../shared/projects-contract.ts';
import { ApiFailure, api } from '../../api.ts';
import { Confirm } from '../../shell/Confirm.tsx';
import { useSheetHold } from '../../shell/useSheetHold.ts';
import { useKeepFocus } from './useKeepFocus.ts';

const BAD_LINK =
  "That isn't a link to a claude.ai page. Open the page on claude.ai, press Share and copy its link.";

/**
 * "Add a claude.ai page": paste an artifact's link and name it. The server files it in the project as a card that
 * links out to claude.ai (it never fetches the page). The button that opens it sits in the tabs row (ProjectPage).
 */
export function AddArtifactForm({
  card,
  onClose,
  onAdded,
}: {
  card: ProjectCard;
  /** Closed without adding (Cancel). */
  onClose: () => void;
  /** Added: the name it was filed under. */
  onAdded: (name: string) => void;
}) {
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [linkError, setLinkError] = useState('');
  const [nameError, setNameError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const linkId = useId();
  const nameId = useId();
  const linkRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const dirty = link.trim() !== '' || name.trim() !== '';
  const leave = useSheetHold(dirty);
  const keepFocus = useKeepFocus();

  const cancel = () => {
    if (busy) return;
    if (leave.asking) leave.keep();
    if (dirty) setAsking(true);
    else onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const url = link.trim();
    const title = name.trim();
    setMessage('');
    if (!url) {
      setLinkError('Paste the artifact link first.');
      setNameError('');
      linkRef.current?.focus();
      return;
    }
    if (cleanArtifactUrl(url) === null) {
      setLinkError(BAD_LINK);
      setNameError('');
      linkRef.current?.focus();
      return;
    }
    setLinkError('');
    if (!title) {
      setNameError('Give the page a name.');
      nameRef.current?.focus();
      return;
    }
    setNameError('');
    setBusy(true);
    try {
      await api.projectArtifact({ key: card.key, url, title });
      setBusy(false);
      // The page closes the form and announces it; nothing is left to ask about.
      leave.discard();
      onAdded(title);
    } catch (err) {
      setBusy(false);
      const words = err instanceof ApiFailure ? err.message : 'Something went wrong. Please try again.';
      if (err instanceof ApiFailure && err.status === 400) {
        setLinkError(words);
        linkRef.current?.focus();
      } else setMessage(words);
    }
  };

  return (
    <form
      className="card proj-card proj-form"
      aria-label="Add a claude.ai page"
      noValidate
      onSubmit={(e) => void submit(e)}
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
            onClose();
          }}
          onCancel={() => {
            if (leave.asking) leave.keep();
            setAsking(false);
            keepFocus.restore();
          }}
        />
      ) : null}
      <div className="form-field">
        <label htmlFor={linkId}>claude.ai link</label>
        <input
          ref={linkRef}
          id={linkId}
          className="field"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://claude.ai/artifact/…"
          value={link}
          aria-invalid={linkError ? true : undefined}
          aria-describedby={linkError ? `${linkId}-err` : undefined}
          onChange={(e) => {
            setLink(e.target.value);
            if (linkError) setLinkError('');
          }}
          // biome-ignore lint/a11y/noAutofocus: the person just pressed Add a claude.ai page.
          autoFocus
        />
        {linkError ? (
          <p className="error" id={`${linkId}-err`} role="alert">
            {linkError}
          </p>
        ) : null}
      </div>
      <div className="form-field">
        <label htmlFor={nameId}>Name</label>
        <input
          ref={nameRef}
          id={nameId}
          className="field"
          type="text"
          autoComplete="off"
          maxLength={200}
          value={name}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? `${nameId}-err` : undefined}
          onChange={(e) => {
            setName(e.target.value);
            if (nameError) setNameError('');
          }}
        />
        {nameError ? (
          <p className="error" id={`${nameId}-err`} role="alert">
            {nameError}
          </p>
        ) : null}
      </div>
      {message ? (
        <p className="error" role="alert">
          {message}
        </p>
      ) : null}
      <div className="proj-buttons">
        <button type="submit" className="btn" data-variant="primary" aria-disabled={busy || undefined}>
          Add
        </button>
        <button type="button" className="btn" aria-disabled={busy || undefined} onClick={cancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
