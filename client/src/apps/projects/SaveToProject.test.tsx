// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { composeChatSummary } from '../../../../shared/chat-summary.ts';
import type { ChatSummaryDraft } from '../../../../shared/chat-summary-contract.ts';
import { card, projectList } from './testing.ts';

const store = vi.hoisted(() => ({
  boot: { identity: { slug: 'me' } },
  todos: {
    changes: 'on',
    canProject: true,
    canAttach: true,
    canUsePersonal: true,
    team: [
      { slug: 'me', name: 'Me' },
      { slug: 'jo', name: 'Jo Lee' },
      { slug: 'sam', name: 'Sam Roe' },
    ],
  },
  changeTodos: vi.fn(),
  openPast: vi.fn(),
}));
const api = vi.hoisted(() => ({
  chatSummaryDraft: vi.fn(),
  changeProject: vi.fn(),
  projects: vi.fn(),
}));
vi.mock('../../api.ts', () => ({
  api,
  ApiFailure: class ApiFailure extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));
vi.mock('../../store.tsx', () => ({ useStore: () => store }));

const { SaveToProject } = await import('./SaveToProject.tsx');
const { projectsStore } = await import('../../state/projects.ts');
const { ApiFailure } = await import('../../api.ts');

const SKY = card({ slug: 'site', title: 'Sky site', owner: 'me', team: ['jo'], version: 'v1' });
const KEY = SKY.key;
const CHAT = '11111111-2222-3333-4444-555555555555';

const draft = (over: Partial<ChatSummaryDraft> = {}): ChatSummaryDraft => ({
  chat: CHAT,
  project: KEY,
  title: 'Fix the redirects',
  fields: {
    objective: 'Fix the old redirects.',
    outcome: 'All 40 redirects now work.',
    figures: ['40 redirects', '3 pages'],
    nextSteps: ['Tell the client', 'Check Search Console'],
  },
  documents: [
    { ref: 'clients/skyseal/report.pdf', name: 'Report', kind: 'file', picked: true },
    { ref: 'clients/skyseal/spare.md', name: 'Spare', kind: 'file', picked: false },
    { ref: 'personal/notes.md', name: 'My notes', kind: 'file', picked: true },
  ],
  fromEmail: false,
  earlier: [],
  nothingNew: false,
  ...over,
});

const changed = vi.fn();
function show(onClose = vi.fn()) {
  render(<SaveToProject chat={CHAT} title="Fix the redirects" project={KEY} onClose={onClose} />);
  return onClose;
}

beforeEach(() => {
  projectsStore.apply(projectList([SKY]));
  api.chatSummaryDraft.mockResolvedValue(draft());
  api.changeProject.mockImplementation(async (a: unknown) => {
    changed(a);
    return projectList([SKY]);
  });
  store.changeTodos.mockResolvedValue({ done: 1 });
  store.openPast.mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  projectsStore.reset();
  vi.clearAllMocks();
});

describe('SaveToProject', () => {
  it('says Claude is writing, and Cancel closes without saving', async () => {
    api.chatSummaryDraft.mockReturnValue(new Promise(() => {}));
    // Its own chat id: a request still running is shared by the next form for the same chat.
    const onClose = vi.fn();
    render(
      <SaveToProject
        chat="99999999-2222-3333-4444-555555555555"
        title="Slow chat"
        project={KEY}
        onClose={onClose}
      />,
    );
    expect(screen.getByText('Claude is writing a summary…')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledWith(false);
    expect(api.changeProject).not.toHaveBeenCalled();
  });

  it('shows a failure with Try again, which asks again', async () => {
    api.chatSummaryDraft.mockRejectedValueOnce(new ApiFailure('internal', '', 500));
    show();
    expect(await screen.findByText(/Claude couldn't write a summary this time/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Objective')).toBeTruthy();
    expect(api.chatSummaryDraft).toHaveBeenCalledTimes(2);
  });

  it('shows the draft, ticks Claude’s picks, disables a personal file on a shared project, client-safe off', async () => {
    show();
    expect((await screen.findByLabelText<HTMLTextAreaElement>('Objective')).value).toBe(
      'Fix the old redirects.',
    );
    expect(screen.getByLabelText<HTMLTextAreaElement>('Key figures').value).toBe('40 redirects\n3 pages');
    expect(screen.getByLabelText<HTMLTextAreaElement>('Next steps').value).toBe(
      'Tell the client\nCheck Search Console',
    );
    expect(screen.getByLabelText<HTMLInputElement>('Report').checked).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>('Spare').checked).toBe(false);
    const mine = screen.getByRole('checkbox', { name: /My notes/ }) as HTMLInputElement;
    expect(mine.disabled).toBe(true);
    expect(mine.checked).toBe(false);
    expect(screen.getByText('Only on your Mac')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Fine to share with the client').checked).toBe(false);
    expect(screen.queryByText(/came from your email/)).toBeNull();
    expect(screen.queryByText(/You saved this chat on/)).toBeNull();
  });

  it('shows the email, earlier and nothing-new notices', async () => {
    api.chatSummaryDraft.mockResolvedValue(
      draft({
        fromEmail: true,
        earlier: [{ path: 'p', at: '2026-11-24T10:00:00Z' }],
        nothingNew: true,
      }),
    );
    show();
    expect(
      await screen.findByText(
        'Some of this came from your email. Saving it here is your OK for exactly this text.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("You saved this chat on 24 Nov 2026. This summary covers what's happened since."),
    ).toBeTruthy();
    expect(screen.getByText(/nothing new/)).toBeTruthy();
  });

  it('reopens the chat from Open chat', async () => {
    show();
    await screen.findByLabelText('Objective');
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));
    await waitFor(() => expect(store.openPast).toHaveBeenCalledWith(CHAT, { in: 'drawer' }));
  });

  it('says why Save cannot be pressed, and sends nothing', async () => {
    show();
    const objective = await screen.findByLabelText('Objective');
    fireEvent.change(objective, { target: { value: '   ' } });
    expect(screen.getByText('Write the objective first.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save to project' }));
    expect(api.changeProject).not.toHaveBeenCalled();
    fireEvent.change(objective, { target: { value: 'x'.repeat(501) } });
    expect(screen.getAllByText(/too long/i).length).toBeGreaterThan(0);
    fireEvent.change(objective, { target: { value: 'Fine' } });
    fireEvent.change(screen.getByLabelText('Outcome'), { target: { value: '' } });
    expect(screen.getByText('Write the outcome first.')).toBeTruthy();
  });

  it('saves the edited, composed body as a chat entry', async () => {
    show();
    fireEvent.change(await screen.findByLabelText('Outcome'), { target: { value: 'Done and checked.' } });
    fireEvent.click(screen.getByLabelText('Spare'));
    fireEvent.click(screen.getByLabelText('Fine to share with the client'));
    fireEvent.click(screen.getByRole('button', { name: 'Save to project' }));
    await screen.findByText("Saved to Sky site's updates.");
    expect(changed).toHaveBeenCalledWith({
      kind: 'update',
      key: KEY,
      entry: {
        kind: 'chat',
        summary: composeChatSummary({
          objective: 'Fix the old redirects.',
          outcome: 'Done and checked.',
          figures: ['40 redirects', '3 pages'],
          documents: [
            { ref: 'clients/skyseal/report.pdf', name: 'Report' },
            { ref: 'clients/skyseal/spare.md', name: 'Spare' },
          ],
          nextSteps: ['Tell the client', 'Check Search Console'],
        }),
        clientSafe: true,
        chat: CHAT,
        title: 'Fix the redirects',
      },
    });
  });

  it('tells the page once the entry is written, so the list shows it before Done; not on a refused save', async () => {
    const onSaved = vi.fn();
    render(<SaveToProject chat={CHAT} title="Fix the redirects" project={KEY} onSaved={onSaved} onClose={vi.fn()} />);
    await screen.findByLabelText('Objective');
    api.changeProject.mockRejectedValueOnce(new ApiFailure('not-allowed', 'Refused.', 403));
    fireEvent.click(screen.getByRole('button', { name: 'Save to project' }));
    await screen.findByText('Refused.');
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save to project' }));
    await screen.findByText("Saved to Sky site's updates.");
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('keeps the form and says so when the save is refused', async () => {
    api.changeProject.mockRejectedValueOnce(
      new ApiFailure('not-allowed', 'Only the person who ran the chat can save it.', 403),
    );
    show();
    await screen.findByLabelText('Objective');
    fireEvent.click(screen.getByRole('button', { name: 'Save to project' }));
    expect(await screen.findByText('Only the person who ran the chat can save it.')).toBeTruthy();
    expect(screen.getByLabelText('Objective')).toBeTruthy();
  });

  describe('after saving: to-dos from the next steps', () => {
    const saved = async () => {
      const onClose = show();
      await screen.findByLabelText('Objective');
      fireEvent.click(screen.getByRole('button', { name: 'Save to project' }));
      await screen.findByText("Saved to Sky site's updates.");
      return onClose;
    };

    it('adds only the ticked steps, one at a time, with who and the details line', async () => {
      await saved();
      expect(screen.getByText('Make to-dos from the next steps?')).toBeTruthy();
      const ticks = screen.getAllByRole('checkbox');
      expect(ticks.every((t) => !(t as HTMLInputElement).checked)).toBe(true);
      fireEvent.click(screen.getByLabelText('Make a to-do: Check Search Console'));
      fireEvent.change(screen.getByLabelText('To-do title for step 2'), {
        target: { value: 'Check Search Console on Friday' },
      });
      const who = screen.getAllByRole('combobox');
      expect((who[1] as HTMLSelectElement).value).toBe('me');
      fireEvent.change(who[1] as HTMLSelectElement, { target: { value: 'jo' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add to-dos' }));
      expect(await screen.findByText('Added 1 to-do.')).toBeTruthy();
      expect(store.changeTodos).toHaveBeenCalledTimes(1);
      const action = store.changeTodos.mock.calls[0]?.[0][0];
      expect(action).toMatchObject({
        kind: 'add',
        title: 'Check Search Console on Friday',
        assignee: 'jo',
        project: KEY,
        client: 'skyseal',
      });
      expect(action.details).toMatch(/^From the chat summary saved on \d+ \w+ \d{4}\.$/);
    });

    it('names the ones that failed and reports how many were added', async () => {
      store.changeTodos
        .mockResolvedValueOnce({ done: 1 })
        .mockResolvedValueOnce({ done: 0, error: { code: 'internal', message: 'No' } });
      await saved();
      fireEvent.click(screen.getByLabelText('Make a to-do: Tell the client'));
      fireEvent.click(screen.getByLabelText('Make a to-do: Check Search Console'));
      fireEvent.click(screen.getByRole('button', { name: 'Add to-dos' }));
      expect(await screen.findByText('Added 1 to-do.')).toBeTruthy();
      expect(screen.getByRole('alert').textContent).toContain("This one wasn't added: Check Search Console");
    });

    it('Done closes as saved; skipping to-dos is fine', async () => {
      const onClose = await saved();
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(onClose).toHaveBeenCalledWith(true);
      expect(store.changeTodos).not.toHaveBeenCalled();
    });

    it('offers no to-do step when there are no next steps or to-dos cannot be added', async () => {
      api.chatSummaryDraft.mockResolvedValue(draft({ fields: { ...draft().fields, nextSteps: [] } }));
      await saved();
      expect(screen.queryByText('Make to-dos from the next steps?')).toBeNull();
      cleanup();
      api.chatSummaryDraft.mockResolvedValue(draft());
      store.todos.changes = 'off';
      await saved();
      expect(screen.queryByText('Make to-dos from the next steps?')).toBeNull();
      store.todos.changes = 'on';
    });
  });
});
