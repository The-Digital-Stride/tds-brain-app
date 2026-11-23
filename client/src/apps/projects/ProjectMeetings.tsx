import { useContext, useEffect, useState } from 'react';
import type { MeetingView, ProjectMeetingsResponse } from '../../../../shared/project-meetings-contract.ts';
import type { ProjectKey } from '../../../../shared/projects-contract.ts';
import { api } from '../../api.ts';
import { StateNote } from '../../shell/StateNote.tsx';
import { ShellContext } from '../../shell/shell-context.ts';
import { projectChatPlace } from '../../state/chat-project.ts';
import { useStore } from '../../store.tsx';
import { openLibraryItem } from '../shared/search.ts';

export interface MeetingsState {
  data: ProjectMeetingsResponse | null;
  error: boolean;
  retry: () => void;
}

/** Reads a project's meetings once per project; the Meetings and Coming up cards share the result. */
export function useProjectMeetings(key: ProjectKey, enabled: boolean): MeetingsState {
  const [data, setData] = useState<ProjectMeetingsResponse | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the read for "Try again".
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setData(null);
    setError(false);
    Promise.resolve()
      .then(() => api.projectMeetings(key))
      .then((res) => {
        if (live) setData(res);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [key, enabled, attempt]);
  return { data, error, retry: () => setAttempt((n) => n + 1) };
}

function parts(date: Date, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-GB', opts).formatToParts(date)) out[p.type] = p.value;
  return out;
}

/** "Tue 25 Nov, 14:30" (the person's own time zone). */
export function meetingWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = parts(d, { weekday: 'short', day: 'numeric', month: 'short' });
  const time = parts(d, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day.weekday} ${day.day} ${day.month}, ${time.hour}:${time.minute}`;
}

/** "Tuesday 25 November at 14:30", for the File the notes prompt. */
function promptWhen(iso: string): string {
  const d = new Date(iso);
  const day = parts(d, { weekday: 'long', day: 'numeric', month: 'long' });
  const time = parts(d, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day.weekday} ${day.day} ${day.month} at ${time.hour}:${time.minute}`;
}

/** The meeting's date as YYYY-MM-DD in the person's own time zone (for ordering beside to-do dates). */
export function meetingDate(iso: string): string {
  const d = new Date(iso);
  const p = parts(d, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}

function withWords(m: MeetingView): string {
  const names = m.people.join(', ');
  const extra = Math.max(0, m.others - m.people.length);
  if (!names) return m.others > 0 ? `With ${m.others} ${m.others === 1 ? 'other' : 'others'}` : '';
  return `With ${names}${extra > 0 ? ` +${extra}` : ''}`;
}

function checkedWords(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** The prompt for "File the notes". Never holds the invite's title (anyone can write one). */
export function fileNotesPrompt(m: MeetingView, place: string): string {
  const head = `File the notes for my meeting on ${promptWhen(m.start)} with the meeting-notes skill.`;
  return m.match === 'only'
    ? `${head} It's probably for the ${place} project; check that with me.`
    : `${head} It's for the ${place} project.`;
}

function MeetingLine({
  label,
  meeting,
  action,
}: {
  label: string;
  meeting: MeetingView;
  action?: React.ReactNode;
}) {
  const who = withWords(meeting);
  const when = meetingWhen(meeting.start);
  return (
    <li>
      <div className="line proj-static proj-meeting">
        <span className="line-text">
          <span className="line-title">
            {label}: {meeting.title}
          </span>
          <span className="line-meta">{[when, who].filter(Boolean).join(' · ')}</span>
        </span>
        {action}
      </div>
    </li>
  );
}

/** The "Meetings" card on a project's Overview: this person's last and next meeting, from their own calendar. */
export function ProjectMeetings({
  card,
  clients,
  meetings,
}: {
  card: {
    key: ProjectKey;
    title: string;
    client: string | null;
    space: 'client' | 'internal' | 'personal' | string;
  };
  clients: readonly { slug: string; name: string }[];
  meetings: MeetingsState;
}) {
  const { openView, startChat } = useStore();
  const shell = useContext(ShellContext);
  const dispatch = shell?.dispatch ?? (() => {});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const { data, error, retry } = meetings;

  const clientName = clients.find((c) => c.slug === card.client)?.name ?? '';
  const place = clientName ? `${clientName} ${card.title}` : card.title;

  const fileNotes = async (m: MeetingView) => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const { client, project } = projectChatPlace(card as Parameters<typeof projectChatPlace>[0], clients);
      // The store's startChat refreshes the Chats list too and, on failure, shows its own error (as Ad Manager).
      await startChat(fileNotesPrompt(m, place), client, { open: true, in: 'drawer', project });
    } catch {
      setMessage("Couldn't start the chat. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const openNotes = async (id: string) => {
    setMessage('');
    const missing = "Those notes can't be opened from here. Look for them under Files.";
    try {
      const found = (await api.libraryItems([id])).files[0];
      if (!found) {
        setMessage(missing);
        return;
      }
      openLibraryItem('documents', found.scope.id, found.item);
      openView('app:documents');
      dispatch({ type: 'set-panel', open: true });
    } catch {
      setMessage(missing);
    }
  };

  let body: React.ReactNode;
  if (error) {
    body = (
      <StateNote kind="error" onRetry={retry}>
        Couldn't read your meetings.
      </StateNote>
    );
  } else if (!data) {
    body = <StateNote kind="loading" />;
  } else if (data.cache === 'none') {
    body = <StateNote kind="empty">Your meetings show here after /gm has checked your calendar.</StateNote>;
  } else {
    const { last, next } = data;
    body = (
      <>
        {data.cache === 'stale' && checkedWords(data.checked) ? (
          <p className="hint">Calendar last checked {checkedWords(data.checked)}.</p>
        ) : null}
        {!last && !next ? (
          <StateNote kind="empty">No meetings found for this project in your calendar.</StateNote>
        ) : (
          <ul className="lib-list">
            {last ? (
              <MeetingLine
                label="Last meeting"
                meeting={last}
                action={
                  last.notes ? (
                    <span className="proj-notes">
                      <span className="hint">Notes filed</span>
                      <button
                        type="button"
                        className="btn"
                        data-variant="quiet"
                        data-size="small"
                        aria-label={`Open notes for ${last.title}`}
                        onClick={() => last.notes && void openNotes(last.notes.id)}
                      >
                        Open notes
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn"
                      data-variant="quiet"
                      data-size="small"
                      aria-disabled={busy || undefined}
                      onClick={() => void fileNotes(last)}
                    >
                      File the notes
                    </button>
                  )
                }
              />
            ) : null}
            {next ? <MeetingLine label="Next meeting" meeting={next} /> : null}
          </ul>
        )}
      </>
    );
  }

  return (
    <section className="card proj-card" aria-labelledby="proj-meetings">
      <div className="card-head">
        <h3 id="proj-meetings">Meetings</h3>
      </div>
      {body}
      <p className={message ? 'proj-note' : 'visually-hidden'} role="status">
        {message}
      </p>
    </section>
  );
}
