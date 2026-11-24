import { useEffect, useRef, useState } from 'react';
import type { SaveChatRequest, UnsavedChat } from '../../../../shared/chat-summary-contract.ts';
import type { ProjectKey } from '../../../../shared/projects-contract.ts';
import { api } from '../../api.ts';
import { dateWords } from './logic.ts';

/**
 * "Chats not saved yet" on a project's Overview: this person's chats for the project with new messages since they last
 * saved one here, up to five. Each opens the Save to project form on the Updates tab. Nothing is saved for them. Shows
 * nothing when there are none, or when saving isn't possible, or when the list can't be read.
 */
export function ProjectUnsavedChats({
  projectKey,
  onSave,
}: {
  projectKey: ProjectKey;
  onSave: (req: SaveChatRequest) => void;
}) {
  const [chats, setChats] = useState<UnsavedChat[]>([]);
  const live = useRef(projectKey);
  live.current = projectKey;

  useEffect(() => {
    setChats([]);
    api.projectUnsavedChats(projectKey).then(
      (r) => {
        if (live.current === projectKey) setChats(r.canSave ? r.chats : []);
      },
      () => {
        // A card that can't load stays out of the way; the rest of the page works without it.
      },
    );
  }, [projectKey]);

  if (chats.length === 0) return null;
  return (
    <section className="card proj-card" aria-labelledby="proj-unsaved">
      <div className="card-head">
        <h3 id="proj-unsaved">Chats not saved yet</h3>
      </div>
      <ul className="lib-list">
        {chats.map((c) => (
          <li key={c.chat}>
            <div className="line proj-update proj-email-row">
              <div className="proj-update-body">
                <span className="line-title proj-email-subject">{c.title || 'Untitled chat'}</span>
                <span className="line-meta">
                  Last active {dateWords(c.lastActive)}
                  {c.savedAt ? ` · last saved ${dateWords(c.savedAt)}` : ''}
                </span>
              </div>
              <button
                type="button"
                className="btn"
                data-size="small"
                aria-label={`Save to project: ${c.title || 'Untitled chat'}`}
                onClick={() => onSave({ key: projectKey, chat: c.chat, title: c.title })}
              >
                Save to project
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
