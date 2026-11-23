// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveSession } from '../../../shared/contract.ts';
import { api } from '../api.ts';
import type { ChatState } from '../state/chat-reducer.ts';

const h = vi.hoisted(() => ({
  role: 'scout' as string,
  activeChat: { kind: 'live', sessionId: 's1' } as unknown,
  chat: undefined as unknown,
  live: null as unknown,
  setChatKind: vi.fn(),
}));
vi.mock('../store.tsx', () => ({
  useToolSnapshot: () => ({ ads: null }),
  useStore: () => ({
    boot: {
      identity: { role: h.role },
      clients: [{ slug: 'acme', name: 'Acme Heating' }],
      engine: { permissionMode: 'default' },
    },
    activeChat: h.activeChat,
    setChatKind: h.setChatKind,
    chats: h.chat ? { s1: h.chat } : {},
    sessions: { live: h.live ? [h.live] : [], past: [] },
    todos: {
      mine: [{ key: '20261111-board.md', title: 'Write the call tracking case' }],
      open: [],
      othersCount: 0,
    },
  }),
}));

const { Inspector } = await import('./Inspector.tsx');
const { ShellProvider } = await import('./ShellProvider.tsx');

const liveChat = (over: Partial<LiveSession> = {}): LiveSession => ({
  id: 's1',
  sdkSessionId: 'abc-123',
  title: 'Report check',
  client: 'acme',
  todoId: '20261111-board.md',
  state: 'idle',
  startedAt: '2026-11-11T16:42:00.000Z',
  lastActivityAt: '2026-11-11T16:50:00.000Z',
  kind: 'tds',
  ...over,
});

const chatState = (items: ChatState['items']): ChatState => ({
  lastSeq: 1,
  sessionState: 'working',
  stateDetail: null,
  stateSince: null,
  sdkSessionId: null,
  model: null,
  effort: null,
  level: null,
  unlevelledSkill: null,
  compacting: false,
  compactionFailed: false,
  context: null,
  lastCompaction: null,
  files: { files: [], attachments: [], links: [] },
  items,
});

function renderPanel() {
  return render(
    <ShellProvider>
      <Inspector />
    </ShellProvider>,
  );
}

beforeEach(() => {
  h.role = 'scout';
  h.activeChat = { kind: 'live', sessionId: 's1' };
  h.setChatKind.mockReset();
  h.live = liveChat();
  h.chat = chatState([
    { kind: 'user', id: 'u', text: 'hi' },
    {
      kind: 'tool',
      id: 't1',
      tool: 'Task',
      label: 'Asked a helper',
      status: 'ok',
      children: [
        { kind: 'tool', id: 't1a', tool: 'Read', label: 'Read business.md', status: 'failed', children: [] },
      ],
    },
    { kind: 'tool', id: 't2', tool: 'Bash', label: 'Counted enquiries', status: 'running', children: [] },
  ]);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('the "This chat" panel', () => {
  it('offers Files and Details, opening on Files (the steps are in the chat itself)', () => {
    renderPanel();
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['Files', 'Details']);
    expect(screen.getByRole('radio', { name: 'Files' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText('No steps yet.')).toBeNull();
  });

  it('keeps the Show switch in the fixed band above what it shows, so it never scrolls away', () => {
    renderPanel();
    const band = screen.getByRole('radiogroup', { name: 'Show' }).closest('.drawer-tools') as HTMLElement;
    expect(band).not.toBeNull();
    const list = band.parentElement?.querySelector(':scope > .drawer-scroll') as HTMLElement;
    expect(list).not.toBeNull();
    expect(list.contains(band)).toBe(false);
    expect(band.parentElement?.classList.contains('drawer-split')).toBe(true);
  });

  it('switches between Files and Details', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('radio', { name: 'Details' }));
    expect(screen.getByRole('radio', { name: 'Details' }).getAttribute('aria-checked')).toBe('true');
    const terms = Array.from(document.querySelectorAll('dt')).map((d) => d.textContent);
    expect(terms).toEqual([
      'Client',
      'Kind',
      'To-do',
      'Started',
      'State',
      'Approvals',
      'Continue in the terminal',
    ]);
    expect(screen.getByText('Acme Heating')).toBeTruthy();
    expect(screen.getByText('Write the call tracking case')).toBeTruthy();
    expect(screen.getByText('Working')).toBeTruthy();
    expect(screen.getByText('Claude asks before it changes a file or runs a command.')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Files' }));
    expect(screen.getByRole('radio', { name: 'Files' }).getAttribute('aria-checked')).toBe('true');
    expect(document.querySelectorAll('dt')).toHaveLength(0);
  });

  it('leaves out the to-do when the chat has none, and says "No client" when there is none', () => {
    h.live = liveChat({ todoId: null, client: null });
    renderPanel();
    fireEvent.click(screen.getByRole('radio', { name: 'Details' }));
    expect(screen.queryByText('To-do')).toBeNull();
    expect(screen.getByText('No client')).toBeTruthy();
  });

  it.each(['owner', 'scout'])('shows the resume line to an %s', (role) => {
    h.role = role;
    renderPanel();
    fireEvent.click(screen.getByRole('radio', { name: 'Details' }));
    expect(screen.getByText('claude --resume abc-123')).toBeTruthy();
    expect(screen.getByText(/do not show in the terminal's own list/)).toBeTruthy();
  });

  it.each(['team', 'unknown'])('never shows the resume line to %s', (role) => {
    h.role = role;
    renderPanel();
    fireEvent.click(screen.getByRole('radio', { name: 'Details' }));
    expect(screen.queryByText(/claude --resume/)).toBeNull();
    expect(screen.queryByText('Continue in the terminal')).toBeNull();
  });

  it('shows the chat kind and switches it', () => {
    h.live = liveChat({ kind: 'personal' });
    renderPanel();
    fireEvent.click(screen.getByRole('radio', { name: 'Details' }));
    const group = screen.getByRole('radiogroup', { name: 'Kind of chat' });
    expect(within(group).getByRole('radio', { name: 'Personal' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(group).getByRole('radio', { name: 'TDS' }));
    expect(h.setChatKind).toHaveBeenCalledWith('s1', 'tds');
  });

  it('renders nothing on Home (a new chat)', () => {
    h.activeChat = { kind: 'new', key: 1, draft: '', skill: null, todoId: null };
    const { container } = renderPanel();
    expect(container.textContent).toBe('');
  });

  describe('Context', () => {
    const reading = {
      type: 'context' as const,
      usedTokens: 84_000,
      limitTokens: 150_000,
      windowTokens: 200_000,
      percent: 56,
      autoCompact: true,
      source: 'engine' as const,
      at: 1,
    };
    const open = () => {
      renderPanel();
      fireEvent.click(screen.getByRole('radio', { name: 'Details' }));
      fireEvent.click(screen.getByRole('button', { name: /Context/ }));
    };

    it('asks for the detail on open and shows items, the last summary and the approximate note', async () => {
      const spy = vi.spyOn(api, 'chatContext').mockResolvedValue({
        reading,
        approximate: true,
        items: [
          { name: 'Messages', tokens: 9300, group: 'messages' },
          { name: 'Gmail connector', tokens: 4000, group: 'connectors', advice: 'Turn it off if unused.' },
          { name: 'Vercel tools', tokens: 194_000, group: 'tools', deferred: true },
        ],
        lastCompaction: {
          type: 'compaction',
          phase: 'done',
          id: 'c:1',
          trigger: 'auto',
          preTokens: 150_000,
          postTokens: 20_000,
          at: 1,
        },
      });
      open();
      expect(await screen.findByText('9.3k')).toBeTruthy();
      expect(spy).toHaveBeenCalledWith('s1');
      expect(screen.getByText('84k of 150k tokens before Claude summarises')).toBeTruthy();
      expect(screen.getByText('Most this model can hold: 200k tokens')).toBeTruthy();
      expect(screen.getByText('Turn it off if unused.')).toBeTruthy();
      expect(screen.getByText('Vercel tools')).toBeTruthy();
      expect(
        screen.getByText("From Claude's last reply. Open this again in a minute for the full list."),
      ).toBeTruthy();
      expect(screen.getByText('Last summary: 150k down to 20k tokens')).toBeTruthy();
    });

    it.each([
      ['before', true],
      ['after', false],
    ])(
      'asks once when the full read sends its own reading %s the answer, and keeps it exact',
      async (_when, early) => {
        const fresh = { ...reading, at: 5 };
        let answer: (v: Awaited<ReturnType<typeof api.chatContext>>) => void = () => {};
        const spy = vi.spyOn(api, 'chatContext').mockImplementation(
          () =>
            new Promise((r) => {
              answer = r;
            }),
        );
        const tree = (
          <ShellProvider>
            <Inspector />
          </ShellProvider>
        );
        const { rerender } = render(tree);
        fireEvent.click(screen.getByRole('radio', { name: 'Details' }));
        fireEvent.click(screen.getByRole('button', { name: /Context/ }));
        // The server's full read also sends the reading down the stream.
        const arrive = () => {
          h.chat = { ...(h.chat as ChatState), context: fresh };
          // A new element, so React renders again (the same one is skipped).
          rerender(
            <ShellProvider>
              <Inspector />
            </ShellProvider>,
          );
        };
        if (early) arrive();
        answer({
          reading: fresh,
          items: [{ name: 'Messages', tokens: 9300, group: 'messages' }],
          lastCompaction: null,
          approximate: false,
        });
        expect(await screen.findByText('9.3k')).toBeTruthy();
        if (!early) arrive();
        await new Promise((r) => setTimeout(r, 0));
        expect(spy).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(/Open this again in a minute/)).toBeNull();
      },
    );

    it('asks again when the fold is closed and opened', async () => {
      const spy = vi
        .spyOn(api, 'chatContext')
        .mockResolvedValue({ reading, items: [], lastCompaction: null, approximate: false });
      h.chat = { ...(h.chat as ChatState), context: reading };
      open();
      await screen.findByText('Chat 56% full');
      fireEvent.click(screen.getByRole('button', { name: /Context/ }));
      fireEvent.click(screen.getByRole('button', { name: /Context/ }));
      await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    });

    it('says auto-summarising is off, and has a plain empty state', async () => {
      const spy = vi
        .spyOn(api, 'chatContext')
        .mockResolvedValue({ reading: null, items: [], lastCompaction: null, approximate: false });
      open();
      expect(await screen.findByText(/No reading yet/)).toBeTruthy();
      spy.mockResolvedValue({
        reading: { ...reading, autoCompact: false },
        items: [],
        lastCompaction: null,
        approximate: false,
      });
      cleanup();
      open();
      await waitFor(() =>
        expect(screen.getByText('84k of 200k tokens used. Auto-summarising is off.')).toBeTruthy(),
      );
    });
  });
});
