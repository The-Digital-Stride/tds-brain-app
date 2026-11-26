import type { ProjectKey, TodoProjectMatch } from '../../../shared/projects-contract.ts';
import { chatForTodo } from '../state/attention.ts';
import { todoChatProject } from '../state/chat-project.ts';
import { todoChatClient } from '../state/client-choice.ts';
import { keptDraftKey, keptDrafts, useKeptDraft } from '../state/kept-drafts.ts';
import { useProjects } from '../state/projects.ts';
import { useStore } from '../store.tsx';
import { Icon } from './Icon.tsx';
import { useShell } from './ShellProvider.tsx';
import { todoChatDraft } from './words.ts';

/** The least a to-do row knows about its to-do for a chat: where it is, what it is called, and its client. */
export interface ChatTodo {
  key: string;
  path: string;
  title: string;
  client: string | null;
  /** Where its project (if any) was matched; read for the chat's project. */
  projectMatch?: TodoProjectMatch;
  /** The project already known (a row on that project's own page, live cards only); wins over `projectMatch`. */
  project?: ProjectKey | null;
}

/**
 * The blue chat button at the edge of a to-do row: opens the to-do's chat when it has one, else starts a chat about
 * it. The same button, name and behaviour as in the To-dos drawer (Actions rules 2 and 10).
 */
export function TodoChatButton({
  todo,
  onOpened,
  describedBy,
  in: place,
}: {
  todo: ChatTodo;
  onOpened?: () => void;
  /** Ids of the row's details ("New to you", the details line), read after the button's name. */
  describedBy?: string;
  /** 'drawer' keeps the chat beside the page (Projects); absent or 'sheet' opens it on the chat screen. */
  in?: 'sheet' | 'drawer';
}) {
  const { boot, newChat, sessions, openChat } = useStore();
  const { state: shellState, dispatch, modes } = useShell();
  const { list: projectList } = useProjects();
  const chat = sessions ? chatForTodo(todo.key, sessions.live) : null;
  // A message saved for later from this task's chat (only a chat beside a project's page can be kept).
  const keepKey = keptDraftKey({ todoId: todo.key });
  const waiting = useKeptDraft(place === 'drawer' ? keepKey : null) !== null && !chat;
  const choose = () => {
    // The panel holds unsaved changes: it asks first, and the chat waits for the answer.
    if (shellState.todoPanel?.dirty) return dispatch({ type: 'close-todo' });
    onOpened?.();
    if (chat) {
      // The task has a chat now, so a message saved for its new chat has had its day.
      keptDrafts.drop(keepKey);
      place ? openChat(chat.id, { in: place }) : openChat(chat.id);
    } else {
      const client = todoChatClient(todo, boot?.clients ?? []);
      const project = todo.project ?? todoChatProject(todo, projectList?.projects);
      newChat({
        draft: todoChatDraft(todo as Parameters<typeof todoChatDraft>[0]),
        todoId: todo.key,
        ...(client !== undefined ? { client } : {}),
        ...(project ? { project } : {}),
        ...(place ? { in: place } : {}),
      });
    }
    // The panel (if one is open) makes way for the chat.
    if (shellState.todoPanel) dispatch({ type: 'close-todo', force: true });
    if (modes.drawerOverlays) dispatch({ type: 'close-drawer' });
  };
  return (
    <button
      type="button"
      className="icon-btn todo-go"
      data-todo-open={todo.key}
      aria-label={`${chat ? 'Open chat' : waiting ? 'Open saved message' : 'Start a chat on this'}: ${todo.title}`}
      data-tip={chat ? 'Open chat' : waiting ? 'Open saved message' : 'Start a chat'}
      aria-describedby={describedBy || undefined}
      onClick={choose}
    >
      <Icon name="chat" size={16} />
    </button>
  );
}
