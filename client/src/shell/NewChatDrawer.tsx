import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { NewChatBox } from '../components/NewChatBox.tsx';
import { AUTO, chatPlaceWords, NONE, type ScopePicks } from '../state/chat-project.ts';
import { keptDrafts, sameAsKept } from '../state/kept-drafts.ts';
import { useProjects } from '../state/projects.ts';
import { useStore } from '../store.tsx';
import { ChatDrawerHead } from './ChatDrawerHead.tsx';
import { Confirm } from './Confirm.tsx';
import { useShell } from './ShellProvider.tsx';
import { useDrawerHold } from './useDrawerHold.ts';
import { placeName } from './words.ts';

const FILES_FIRST = 'Send or remove the attached files first.';
/** Open full screen pressed between Send and the chat starting. */
const STARTING = 'Your message is sending. Try again in a moment.';
/** A file attached in the message box (Composer's chips). */
const ATTACHED = '.composer .chip-row .chip';
const BOX = '.composer-input';

/**
 * The chat drawer's unsent state (plan 2026-11-26-project-chat-in-place): a new chat opened beside a project, nothing
 * sent yet. The same header as a live drawer chat, an empty thread that says so, and the shared message box at the
 * bottom. Typed text or attached files are held: Hide chat and anything that would replace the chat asks first.
 */
export function NewChatDrawer() {
  const headingId = useId();
  const { activeChat, boot, expandNewChatDrawer, newChatDrawer, newChatStarting, requestComposerFocus } =
    useStore();
  const { dispatch } = useShell();
  const { list } = useProjects();
  const column = useRef<HTMLDivElement>(null);
  const [picks, setPicks] = useState<ScopePicks | null>(null);
  const [dirty, setDirty] = useState(false);
  const [files, setFiles] = useState(false);
  const [note, setNote] = useState('');
  // "Save for later" (state/kept-drafts.ts): where this chat's message would be kept, and the kept message it opened
  // with, if one was waiting. Unchanged, that one is not asked about again: it is still kept.
  const keepKey = activeChat.kind === 'new' ? activeChat.keepKey : null;
  const kept = activeChat.kind === 'new' ? (activeChat.kept ?? null) : null;
  const preset = activeChat.kind === 'new' ? activeChat.preset.trim() : '';
  const latest = useRef({ picks, kept, keepKey, preset });
  latest.current = { picks, kept, keepKey, preset };
  /**
   * Set once the person has typed in this box, and true while what it holds is nothing of theirs (empty, or only
   * the opener's own text). A drawer that closes like that lets go of the kept message: it was changed to nothing.
   */
  const typedHere = useRef(false);
  const nothingOfTheirs = useRef(false);
  useEffect(
    () => () => {
      if (typedHere.current && nothingOfTheirs.current) keptDrafts.drop(latest.current.keepKey);
    },
    [],
  );
  // Once Send has handed this chat's message over, there is nothing left to discard: the hold stops asking while it
  // starts. Another chat starting elsewhere changes nothing here.
  const starting = newChatStarting != null && newChatStarting === newChatDrawer;
  const hold = useDrawerHold(dirty && !starting);
  // The "sending" note belongs to that one start: gone when it ends, so a later Send doesn't bring it back.
  useEffect(() => {
    if (!starting) setNote((n) => (n === STARTING ? '' : n));
  }, [starting]);

  // Typed work: text in the box, or files attached. Read from the DOM, as the live drawer does.
  const read = useCallback(() => {
    const col = column.current;
    if (!col) return;
    const text = col.querySelector<HTMLTextAreaElement>(BOX)?.value ?? '';
    const attached = col.querySelector(ATTACHED) !== null;
    const now = latest.current;
    // Their own writing: something typed that is not just the text the opener put there.
    const theirs = text.trim() !== '' && text.trim() !== now.preset;
    // A kept message that is back in the box unchanged is still kept, so there is nothing to ask about.
    setDirty(attached || (theirs && !sameAsKept(now.kept, text, now.picks)));
    setFiles(attached);
    if (!attached) setNote((n) => (n === FILES_FIRST ? '' : n));
    nothingOfTheirs.current = !theirs && !attached;
  }, []);
  // The pickers count too: a kept message with a different project or client has changed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: read again when either pick changes
  useEffect(() => read(), [read, picks?.project, picks?.client]);
  // Typing is heard through React (`onInput` below), never a listener of our own on the page: a browser runs such a
  // listener before React's, the state change re-draws the box with its old (empty) text, and React then sees
  // nothing new to report, so the first keys typed were lost. Attached files change the page, so those are watched,
  // and read a moment later for the same reason.
  useEffect(() => {
    const col = column.current;
    if (!col) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watch = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(read, 0);
    });
    watch.observe(col, { childList: true, subtree: true });
    return () => {
      clearTimeout(timer);
      watch.disconnect();
    };
  }, [read]);

  const clients = boot?.clients ?? [];
  const cards = list?.projects;
  const card = picks?.project ? cards?.find((c) => c.key === picks.project) : undefined;
  const slug = picks && picks.client !== AUTO && picks.client !== NONE ? picks.client : null;
  const chip = card ? card.title || card.slug : slug ? placeName(slug, clients) : null;
  const chipTip = chip ? chatPlaceWords(slug, card?.key ?? null, clients, cards) : null;

  const toFullScreen = useCallback(() => {
    const col = column.current;
    if (!col) return;
    // Already sent and starting: the text would arrive on Home as if unsent, and a second Send would start it twice.
    // The chat is live in a moment, with its own Open full screen.
    if (starting) {
      setNote(STARTING);
      return;
    }
    if (col.querySelector(ATTACHED)) {
      setNote(FILES_FIRST);
      col.querySelector<HTMLTextAreaElement>(BOX)?.focus();
      return;
    }
    const text = col.querySelector<HTMLTextAreaElement>(BOX)?.value ?? '';
    expandNewChatDrawer(text, picks ?? { project: '', client: AUTO });
  }, [expandNewChatDrawer, picks, starting]);

  const boxText = () => column.current?.querySelector<HTMLTextAreaElement>(BOX)?.value ?? '';
  const saveForLater = () => {
    if (keepKey) keptDrafts.save(keepKey, { text: boxText(), picks });
    hold.discard();
  };
  const canKeep = keepKey !== null && !files;
  const discard = () => {
    keptDrafts.drop(keepKey);
    hold.discard();
  };

  return (
    <div
      className="chat chat-live"
      ref={column}
      data-placement="drawer"
      onInput={() => {
        typedHere.current = true;
        read();
      }}
      {...{ role: 'region', 'aria-labelledby': headingId }}
    >
      <ChatDrawerHead
        headingId={headingId}
        title="New chat"
        chip={chip}
        chipTip={chipTip}
        onFullScreen={toFullScreen}
        onHide={() => dispatch({ type: 'close-chat-drawer' })}
        note={note}
      />
      {hold.asking ? (
        <Confirm
          // Files can't be kept for later, so with any attached the question is the two-answer one.
          label={canKeep ? 'Save or discard your message' : 'Discard your message'}
          text="Discard what you have written?"
          action="Discard message"
          {...(canKeep ? { extra: { label: 'Save for later', onChoose: saveForLater } } : {})}
          safe="Keep writing"
          variant="danger"
          busy={false}
          onConfirm={discard}
          onCancel={() => {
            hold.keep();
            requestComposerFocus();
          }}
        />
      ) : null}
      <div className="thread">
        <div className="thread-col thread-empty">
          <h3>What would you like to do?</h3>
          <p className="lede">
            {kept ? 'Your message was saved for later. ' : ''}Nothing is sent until you press Send.
          </p>
        </div>
      </div>
      <div className="floater">
        <div className="floater-col">
          <NewChatBox placement="drawer" onPicks={setPicks} />
        </div>
      </div>
    </div>
  );
}
