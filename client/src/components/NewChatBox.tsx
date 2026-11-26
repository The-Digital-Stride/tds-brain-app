import { useEffect, useRef, useState } from 'react';
import type { ClientGuessResponse, ClientPickReported } from '../../../shared/contract.ts';
import { api } from '../api.ts';
import { ClientAsk } from '../shell/ClientAsk.tsx';
import { SearchSelect } from '../shell/SearchSelect.tsx';
import { clientOptions } from '../shell/search-select.ts';
import {
  AUTO,
  chatScope,
  NO_PROJECT,
  NONE,
  pickClient,
  pickProject,
  type ScopePicks,
} from '../state/chat-project.ts';
import { projectChoice, useProjectChoice } from '../state/client-choice.ts';
import { isClearCommand } from '../state/close.ts';
import { filterOptions, useProjects } from '../state/projects.ts';
import { useStore } from '../store.tsx';
import { Composer } from './Composer.tsx';

const ALL = 'all';

/** How much of the first message is used to work out the client. */
const GUESS_CHARS = 4000;
/** The "Working out the client…" note only appears when the guess is slow. */
const STATUS_DELAY_MS = 400;

/**
 * The app-wide picker (decision 11), as one control: "Working on [project]", every live project under its
 * client. Choosing a project narrows Home, the To-dos drawer, Images, Documents and search, and starts a new
 * chat's "Chat for" on that project's client. It sits in the message box beside Chat for, first because it
 * drives it (Ian, 2026-11-21). Shown once the brain has projects.
 */
export function ProjectPicker({
  clients,
  disabled = false,
}: {
  clients: { slug: string; name: string; aliases?: string[] }[];
  /** While a client guess or question is pending, as Chat for: the project can't change the chat mid-send. */
  disabled?: boolean;
}) {
  const { list } = useProjects();
  const project = useProjectChoice();
  const cards = list?.projects ?? [];
  if (cards.length === 0 && !project) return null;
  return (
    <span className="scope-field">
      <label className="client-label" htmlFor="pick-project">
        Working on
      </label>
      <SearchSelect
        id="pick-project"
        className="project-select"
        value={project || ALL}
        options={[{ value: ALL, label: 'All projects' }, ...filterOptions(cards, clients)]}
        recentKey="projects"
        disabled={disabled}
        onChange={(v) => projectChoice.set(v === ALL ? '' : v)}
      />
    </span>
  );
}

/** The message box of a new chat: skill note, client question, status line and the composer with its scope row. */
export function NewChatBox({
  placement = 'sheet',
  onPicks,
}: {
  /** 'sheet' on Home, 'drawer' in the chat drawer: a refused start is repeated in the box's status line there. */
  placement?: 'sheet' | 'drawer';
  /** The chat-bound row's picks, for Open full screen: called when they change, and once on mount. */
  onPicks?: (picks: ScopePicks) => void;
}) {
  const { boot, activeChat, send, composerFocus, actionError } = useStore();
  const clients = boot?.clients ?? [];
  const workingOn = useProjectChoice();
  const { list: projectList } = useProjects();
  const cards = projectList?.projects;
  // What the person picked by hand in this chat (Chat for in Home's own row; both pickers in a chat-bound one).
  const [picked, setPicked] = useState<{ key: number; picks: ScopePicks } | null>(null);
  const [ask, setAsk] = useState<{
    options: string[];
    choose: (slug: string | null) => void;
    cancel: () => void;
  } | null>(null);
  const [status, setStatus] = useState('');
  // True from Send (with auto) until the chat starts or the question is cancelled.
  const [busy, setBusy] = useState(false);
  const cancelAsk = useRef<(() => void) | null>(null);
  // A pending question ends (as "not sent") when Home goes away.
  useEffect(() => () => cancelAsk.current?.(), []);
  // So does opening another new chat.
  const chatKey = activeChat.kind === 'new' ? activeChat.key : -1;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the chat changes
  useEffect(() => () => cancelAsk.current?.(), [chatKey]);
  const listed = (slug: string) => clients.some((c) => c.slug === slug);
  const byHand = activeChat.kind === 'new' && picked?.key === activeChat.key;
  const view = chatScope({
    presetProject: activeChat.kind === 'new' ? (activeChat.project ?? null) : null,
    presetClient: activeChat.kind === 'new' ? activeChat.client : undefined,
    workingOn,
    bound: activeChat.kind === 'new' ? activeChat.scope : 'app',
    picks: byHand ? picked?.picks : activeChat.kind === 'new' ? activeChat.picks : undefined,
    cards,
    clients,
  });
  const chatBound = view.bound === 'chat';
  const choice = view.client;
  const projectFor = view.projectFor;
  // The chat-bound pair as shown, handed up so Open full screen carries it.
  const shown = { project: view.project, client: view.client };
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the shown pair changes
  useEffect(() => {
    if (chatBound) onPicks?.({ project: view.project, client: view.client });
  }, [chatBound, view.project, view.client]);
  const pickedClient = (client: string) =>
    activeChat.kind === 'new' &&
    setPicked({
      key: activeChat.key,
      picks: chatBound ? pickClient(client, shown, cards, clients) : { project: '', client },
    });
  const pickedProject = (key: string) =>
    activeChat.kind === 'new' &&
    setPicked({ key: activeChat.key, picks: pickProject(key, shown, cards, clients) });
  const setByProject = view.clientSetByProject;
  const showProjectPicker = (cards?.length ?? 0) > 0 || view.project !== NO_PROJECT;
  // Counted in the app's own data folder so we can see how often people are asked; never in the way.
  const report = (outcome: ClientPickReported) =>
    void Promise.resolve()
      .then(() => api.clientPickOutcome(outcome))
      .catch(() => {});
  if (activeChat.kind !== 'new') return null;
  return (
    <>
      {activeChat.skill ? (
        <div className="notice home-skill" data-shape="box" data-level="info">
          <strong>{activeChat.skill.title}</strong>
          {activeChat.skill.description ? <span>{activeChat.skill.description}</span> : null}
          {activeChat.skill.argumentHint ? (
            <span className="meta">Add after the name: {activeChat.skill.argumentHint}</span>
          ) : null}
        </div>
      ) : null}
      {ask ? (
        <ClientAsk clients={clients} options={ask.options} onChoose={ask.choose} onCancel={ask.cancel} />
      ) : null}
      <p className="home-status" role="status" aria-live="polite">
        {status || (placement === 'drawer' ? (actionError ?? '') : '')}
      </p>
      <Composer
        key={`new-${activeChat.key}`}
        initial={activeChat.draft}
        skill={activeChat.skill}
        disabledReason={null}
        autoFocus={true}
        focusSignal={composerFocus}
        attention={null}
        hint={ask ? 'Answer the question above, or Cancel to change your message.' : undefined}
        tools={
          <>
            {chatBound ? (
              showProjectPicker ? (
                <span className="scope-field">
                  <label className="client-label" htmlFor="chat-project">
                    Project
                  </label>
                  <SearchSelect
                    id="chat-project"
                    className="project-select"
                    value={view.project}
                    options={[
                      { value: NO_PROJECT, label: 'No project' },
                      ...filterOptions(cards ?? [], clients),
                    ]}
                    recentKey="projects"
                    disabled={busy}
                    onChange={pickedProject}
                  />
                </span>
              ) : null
            ) : (
              <ProjectPicker clients={clients} disabled={busy} />
            )}
            {/* Which client the new chat is about. "Chat for", not "Client", so it isn't read as a
                second Working on picker (Ian, 2026-11-21). */}
            <span className="scope-field">
              <label className="client-label" htmlFor="client-select">
                Chat for
              </label>
              <SearchSelect
                id="client-select"
                className="client-select"
                value={choice}
                options={[
                  { value: AUTO, label: 'Auto' },
                  { value: NONE, label: 'No client' },
                  ...clientOptions(clients),
                ]}
                recentKey="clients"
                disabled={busy}
                aria-describedby={setByProject ? 'client-select-why' : undefined}
                onChange={pickedClient}
              />
              {setByProject ? (
                <span className="visually-hidden" id="client-select-why">
                  Set by {view.projectLabel}
                </span>
              ) : null}
            </span>
          </>
        }
        onSend={async (text, uploadIds) => {
          // "/clear" on Home just empties the box; it is never sent.
          if (isClearCommand(text)) return true;
          if (choice !== AUTO) {
            // Chosen in the select, or set by a to-do or a search result.
            report(byHand ? 'by-hand' : 'preset');
            {
              const client = choice === NONE ? null : choice;
              return send(text, client, uploadIds, projectFor(client));
            }
          }
          // The skill's name alone is not something to read a client from.
          const name = activeChat.skill ? `/${activeChat.skill.name}` : null;
          const message =
            name && (text === name || text.startsWith(`${name} `)) ? text.slice(name.length).trim() : text;
          if (message.trim() === '') {
            report('skill-only');
            return send(text, null, uploadIds, projectFor(null));
          }
          setBusy(true);
          try {
            const timer = setTimeout(() => setStatus('Working out the client…'), STATUS_DELAY_MS);
            // Leaving this chat (or Home) while the guess is out drops it: nothing is sent or shown.
            let gone = false;
            cancelAsk.current = () => {
              gone = true;
              cancelAsk.current = null;
              clearTimeout(timer);
              setStatus('');
              setAsk(null);
              setBusy(false);
            };
            let guess: ClientGuessResponse = { kind: 'ask', options: [] };
            try {
              guess = await api.clientGuess({ text: message.slice(0, GUESS_CHARS) });
            } catch {
              // Any failure is a question with nothing to suggest.
            }
            if (gone) return false;
            cancelAsk.current = null;
            clearTimeout(timer);
            setStatus('');
            if (guess?.kind === 'sure' && listed(guess.client))
              return await send(text, guess.client, uploadIds, projectFor(guess.client));
            if (guess?.kind === 'none') return await send(text, null, uploadIds, projectFor(null));
            const options = guess?.kind === 'ask' && Array.isArray(guess.options) ? guess.options : [];
            return await new Promise<boolean>((resolve) => {
              const done = () => {
                cancelAsk.current = null;
                setAsk(null);
              };
              const cancel = () => {
                done();
                report('ask-cancelled');
                resolve(false);
              };
              cancelAsk.current = cancel;
              setAsk({
                options,
                cancel,
                choose: (slug) => {
                  done();
                  report(
                    slug === null ? 'ask-no-client' : options.includes(slug) ? 'ask-suggested' : 'ask-other',
                  );
                  resolve(send(text, slug, uploadIds, projectFor(slug)));
                },
              });
            });
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
