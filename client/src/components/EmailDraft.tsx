import { useMemo } from 'react';
import { chatEmailLink, chatEmailPeople } from '../../../shared/chat-email-draft.ts';
import { CHAT_EMAIL_RECIPIENTS_MAX, type ChatEmail } from '../../../shared/chat-email-draft-contract.ts';
import { openGmailWindow } from '../shell/gmail-window.ts';
import { useCopy } from '../shell/useCopy.ts';
import { useStore } from '../store.tsx';

/**
 * An email Claude drafted in a chat (plan 2026-11-25-chat-email-to-gmail). Everything Gmail will be given is
 * on the card, as plain text: every address (Bcc too, and never a display name), the subject and the whole
 * message, never clamped, folded or drawn as markdown. "Open in Gmail" fills Gmail's own compose window;
 * nothing is sent or saved until the person does it there.
 * `ready` is false while the block is still arriving: no buttons and no notices yet.
 */
export function EmailDraftCard({ email, ready }: { email: ChatEmail; ready: boolean }) {
  const { boot } = useStore();
  const { said, copy } = useCopy();
  const ownEmail = boot?.identity.email ?? null;
  const link = useMemo(() => chatEmailLink(ownEmail, email), [ownEmail, email]);
  const named = email.subject === '' ? '' : `: ${email.subject}`;
  return (
    <section className="email-draft" aria-label={`Email draft${named}`}>
      <dl className="email-draft-head">
        {chatEmailPeople(email).map(({ label, list }) =>
          list.length > 0 || label === 'To' ? (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{list.length > 0 ? list.join(', ') : 'Nobody yet. Add them in Gmail.'}</dd>
            </div>
          ) : null,
        )}
        {email.subject !== '' ? (
          <div>
            <dt>Subject</dt>
            <dd>{email.subject}</dd>
          </div>
        ) : null}
      </dl>
      <pre className="email-draft-body">{email.body}</pre>
      {ready ? (
        <>
          {email.dropped > 0 ? (
            <p className="notice" data-shape="box" data-level="warn">
              {email.dropped === 1
                ? "1 address was left out: it didn't look like an email address."
                : `${email.dropped} addresses were left out: they didn't look like email addresses.`}
            </p>
          ) : null}
          {email.over > 0 ? (
            <p className="notice" data-shape="box" data-level="warn">
              Only the first {CHAT_EMAIL_RECIPIENTS_MAX} addresses are filled in.
            </p>
          ) : null}
          {link.fits ? null : (
            <p className="notice" data-shape="box" data-level="info">
              This email is too long to fill in for you. Press Copy text, then paste it into the Gmail window.
            </p>
          )}
          <div className="email-draft-actions">
            <a
              className="btn"
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => openGmailWindow(e, link.url)}
            >
              Open in Gmail
              <span className="visually-hidden">{named} (opens Gmail in a small window)</span>
            </a>
            <button
              type="button"
              className="btn"
              aria-label={`Copy text${named}`}
              onClick={() => void copy(email.body)}
            >
              {said ?? 'Copy text'}
            </button>
            <span className="visually-hidden" role="status">
              {said ?? ''}
            </span>
          </div>
        </>
      ) : null}
    </section>
  );
}
