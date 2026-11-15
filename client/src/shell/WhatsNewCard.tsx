import { useMemo } from 'react';
import { HELP_LINK_ATTR } from '../help/contract.ts';
import { helpImageUrl, helpLibrary } from '../help/library.ts';
import { renderHelp } from '../help/render.ts';
import { mayShowNotes, pickNote, whatsNewNotes } from '../help/whats-new.ts';
import { useStore } from '../store.tsx';
import { useTourOpen } from '../tour/index.ts';
import { useShell } from './ShellProvider.tsx';

/**
 * The short "what changed" note on Home, under the greeting and above the message box. It shows the newest note
 * not newer than the app and not yet closed (**Close** saves `whatsNewSeen`). It waits while the tour is open or
 * before the tour has ever run (`tourSeen` null), so the two never compete. A brand-new person (no earlier chats and
 * nothing closed before) never sees notes from before they started: see `mayShowNotes`.
 */
export function WhatsNewCard() {
  const { boot, sessions, updatePrefs } = useStore();
  const { dispatch } = useShell();
  const tourOpen = useTourOpen();
  const body = useMemo(() => {
    const picked = boot ? pickNote(whatsNewNotes, boot.appVersion, boot.prefs.whatsNewSeen) : null;
    return picked ? renderHelp(picked.body, helpImageUrl) : '';
  }, [boot]);
  if (!boot || tourOpen || (boot.prefs.tourSeen ?? null) === null) return null;
  const chatCount = sessions ? sessions.live.length + sessions.past.length : null;
  if (!mayShowNotes(chatCount, boot.prefs.whatsNewSeen)) return null;
  const note = pickNote(whatsNewNotes, boot.appVersion, boot.prefs.whatsNewSeen);
  if (!note) return null;
  const pages = note.pages.flatMap((id) => {
    const t = helpLibrary.byId(id);
    return t ? [{ id, title: t.title }] : [];
  });
  return (
    <section className="card whats-new" aria-labelledby="whats-new-title">
      <div className="card-head">
        <span className="badge">New in {note.version.replace(/\.0$/, '')}</span>
        <h2 id="whats-new-title">{note.title}</h2>
      </div>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the links inside are real anchors, which handle the keyboard. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: click delegation for those anchors. */}
      <div
        className="help-article whats-new-text"
        onClick={(e) => {
          const id = (e.target as Element).closest?.(`[${HELP_LINK_ATTR}]`)?.getAttribute(HELP_LINK_ATTR);
          if (!id) return;
          e.preventDefault();
          dispatch({ type: 'open-help', page: id });
        }}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: the HTML is sanitised by renderHelp.
        dangerouslySetInnerHTML={{ __html: body }}
      />
      <div className="whats-new-actions">
        {pages.map((p) => (
          <button
            key={p.id}
            type="button"
            className="btn"
            data-variant="quiet"
            data-size="small"
            onClick={() => dispatch({ type: 'open-help', page: p.id })}
          >
            {p.title}
          </button>
        ))}
        <button
          type="button"
          className="btn"
          data-variant="quiet"
          data-size="small"
          aria-label="Close What's new"
          onClick={() => {
            void updatePrefs({ whatsNewSeen: note.version });
            // The card goes, so focus moves on to the message box rather than dropping to the page.
            document.querySelector<HTMLElement>('.home-composer .composer-input')?.focus();
          }}
        >
          Close
        </button>
      </div>
    </section>
  );
}
