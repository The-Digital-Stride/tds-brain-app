// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatItem, ChatState, PermissionItem } from '../state/chat-reducer.ts';

const h = vi.hoisted(() => ({
  chat: null as unknown,
  lastActivityAt: '2026-11-11T10:00:00.000Z',
  composerFocus: 0,
  requestComposerFocus: vi.fn(),
  openView: vi.fn(),
  requestSettingsFocus: vi.fn(),
  setChatLevel: vi.fn().mockResolvedValue(undefined),
  setSkillLevel: vi.fn().mockResolvedValue(true),
  dismissLevelOffer: vi.fn(),
  skillLevels: null as unknown,
  hideChatDrawer: vi.fn(),
  expandChatDrawer: vi.fn(),
  chatDrawer: null as string | null,
  live: { sdkSessionId: null as string | null, project: undefined as string | undefined },
  projects: null as unknown,
  openChat: vi.fn(),
}));
const api = vi.hoisted(() => ({
  answerPermission: vi.fn().mockResolvedValue({ ok: true }),
  answerQuestion: vi.fn().mockResolvedValue({ ok: true }),
}));
const uploads = vi.hoisted(() => ({
  uploadFile: vi.fn(async (_file: File, name: string) => ({
    id: 'up-1',
    name,
    size: 4,
    kind: 'document' as const,
  })),
  discardUpload: vi.fn(async () => undefined),
}));
vi.mock('../api.ts', () => ({ api, ...uploads }));
vi.mock('../store.tsx', () => ({
  useToolSnapshot: () => ({ ads: null }),
  useStore: () => ({
    boot: {
      prefs: { pins: [], lastClient: null },
      skills: [],
      clients: [],
      usedOften: [],
      identity: { role: 'team' },
      brain: { path: '/brain' },
    },
    activeChat: { kind: 'live', sessionId: 's1' },
    chats: { s1: h.chat },
    sessions: {
      live: [
        {
          id: 's1',
          title: 'T',
          client: null,
          sdkSessionId: h.live.sdkSessionId,
          project: h.live.project,
          lastActivityAt: h.lastActivityAt,
        },
      ],
      past: [],
    },
    send: async () => true,
    run: async (fn: () => Promise<unknown>) => {
      await fn();
      return true;
    },
    actionError: null,
    clearError: () => {},
    startSkill: () => {},
    openView: h.openView,
    requestSettingsFocus: h.requestSettingsFocus,
    composerFocus: h.composerFocus,
    requestComposerFocus: h.requestComposerFocus,
    closeRequest: null,
    cancelClose: () => {},
    requestClose: () => {},
    closeChat: async () => true,
    skillLevels: h.skillLevels,
    setChatLevel: h.setChatLevel,
    setSkillLevel: h.setSkillLevel,
    dismissLevelOffer: h.dismissLevelOffer,
    hideChatDrawer: h.hideChatDrawer,
    expandChatDrawer: h.expandChatDrawer,
    chatDrawer: h.chatDrawer,
    openChat: h.openChat,
  }),
}));
vi.mock('../state/projects.ts', async (orig) => ({
  ...(await orig<typeof import('../state/projects.ts')>()),
  useProjects: () => ({ list: h.projects, error: null, refresh: async () => {}, apply: () => {} }),
}));

const { saveChatRequest } = await import('../state/save-chat-request.ts');
const { projectPageRequest } = await import('../state/client-choice.ts');
const { pickOption } = await import('../test/pick.ts');
const { ChatView } = await import('./Chat.tsx');
const { ShellProvider, useShell } = await import('../shell/ShellProvider.tsx');

const sheet = () => (
  <ShellProvider>
    <ChatView />
  </ShellProvider>
);

const chatState = (sessionState: ChatState['sessionState'], stepLabel?: string): ChatState => ({
  lastSeq: 1,
  sessionState,
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
  items: [
    { kind: 'user', id: 'u', text: 'hi' },
    ...(stepLabel
      ? [
          {
            kind: 'tool' as const,
            id: stepLabel,
            tool: 'Edit',
            label: stepLabel,
            status: 'running' as const,
            children: [],
          },
        ]
      : []),
  ],
});

const lines = () => document.querySelectorAll('.attn-text');

afterEach(() => {
  cleanup();
  localStorage.clear();
  h.skillLevels = null;
  h.setChatLevel.mockClear();
  h.hideChatDrawer.mockClear();
  h.chatDrawer = null;
  h.expandChatDrawer.mockClear();
  h.setSkillLevel.mockClear();
  h.dismissLevelOffer.mockClear();
  h.live = { sdkSessionId: null, project: undefined };
  h.projects = null;
  h.openChat.mockClear();
  h.openView.mockClear();
  saveChatRequest.set(null);
  projectPageRequest.set('');
});

describe('status line above the message box', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is always exactly one line, showing the current state', () => {
    const steps: [ChatState['sessionState'], string | undefined, RegExp][] = [
      ['starting', undefined, /^Working/],
      ['working', 'Running a command', /^Working.*Running a command/],
      ['working', 'Editing a.txt', /^Working.*Editing a\.txt/],
      ['waiting', 'Editing a.txt', /^Needs your answer/],
      ['idle', undefined, /^Ready for you/],
    ];
    h.chat = chatState(steps[0]?.[0] ?? 'idle');
    const { rerender } = render(sheet());
    for (const [state, step, expected] of steps) {
      h.chat = chatState(state, step);
      rerender(sheet());
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(lines()).toHaveLength(1);
      expect(lines()[0]?.textContent?.trim()).toMatch(expected);
    }
  });
});

describe('model and effort under the message box', () => {
  it('shows the model and effort once known, after the message box', () => {
    h.chat = chatState('idle');
    const { rerender } = render(sheet());
    expect(document.querySelector('.engine-line')).toBeNull();
    h.chat = { ...chatState('idle'), model: 'claude-opus-5-5', effort: 'high' };
    rerender(sheet());
    const line = document.querySelector('.engine-line');
    expect(line?.querySelector('.engine-text')?.textContent).toBe('Claude is using Opus 5.5 · High effort');
    expect(line?.previousElementSibling?.classList.contains('composer')).toBe(true);
  });

  it('offers Change with the line, and it opens Settings and asks for focus on Model', () => {
    h.chat = chatState('idle');
    const { rerender } = render(sheet());
    expect(screen.queryByRole('button', { name: 'Change model and effort' })).toBeNull();
    h.chat = { ...chatState('idle'), model: 'claude-opus-5-5', effort: 'high' };
    rerender(sheet());
    fireEvent.click(screen.getByRole('button', { name: 'Change model and effort' }));
    expect(h.requestSettingsFocus).toHaveBeenCalledTimes(1);
    expect(h.openView).toHaveBeenCalledWith('settings');
  });
});

describe('the sheet bar', () => {
  it('names the chat as the page heading, leaves out an empty client chip and toggles the panel', () => {
    h.chat = chatState('idle');
    render(sheet());
    const heading = screen.getByRole('heading', { level: 1, name: 'T' });
    // The bar may cut a long title short; the full title is on hover.
    expect(heading.getAttribute('title')).toBe('T');
    // No client: no chip (the panel's Details says "No client").
    expect(screen.queryByText('No client')).toBeNull();
    expect(screen.getByRole('button', { name: 'End chat' })).toBeTruthy();
    const toggle = screen.getByRole('button', { name: 'Files and details' });
    expect(toggle.getAttribute('aria-controls')).toBe('panel');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('puts the panel toggle last, at the top right, after "Search or jump to"', () => {
    h.chat = chatState('idle');
    render(sheet());
    const toggle = screen.getByRole('button', { name: 'Files and details' });
    expect(toggle.parentElement?.lastElementChild).toBe(toggle);
    expect(toggle.previousElementSibling).toBe(screen.getByRole('button', { name: 'Search or jump to' }));
  });
});

const perm = (
  requestId: string,
  title: string,
  outcome: PermissionItem['outcome'] = null,
): PermissionItem => ({
  kind: 'permission',
  requestId,
  tool: 'Write',
  title,
  detail: '',
  warning: null,
  sessionAllowLabel: null,
  change: null,
  outcome,
});

const withItems = (items: ChatItem[]): ChatState => ({ ...chatState('waiting'), items });

const probed: { shell: ReturnType<typeof useShell> | null } = { shell: null };
function ShellProbe() {
  probed.shell = useShell();
  return null;
}

describe('in the chat drawer (plan 2026-11-16-run-chat-drawer)', () => {
  const drawer = () => (
    <ShellProvider>
      <ChatView placement="drawer" />
    </ShellProvider>
  );
  it('has a small header of its own: no page heading, no search, no end-chat button', () => {
    h.chat = chatState('idle');
    render(drawer());
    expect(screen.getByRole('heading', { level: 2, name: 'T' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.queryByRole('button', { name: /Search or jump to/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'End chat' })).toBeNull();
    expect(screen.getByRole('region', { name: 'T' })).toBeTruthy();
  });
  it('Esc hides it, but never while a message is half-typed in it', () => {
    h.chat = chatState('idle');
    h.chatDrawer = 's1';
    render(drawer());
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    box.focus();
    fireEvent.change(box, { target: { value: 'half a thought' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(h.hideChatDrawer).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: '' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(h.hideChatDrawer).toHaveBeenCalledTimes(1);
  });

  it('under a floating left drawer, Esc closes that drawer and leaves the chat', async () => {
    h.chat = chatState('idle');
    h.chatDrawer = 's1';
    const width = window.innerWidth;
    window.innerWidth = 700;
    try {
      render(
        <ShellProvider>
          <ShellProbe />
          <ChatView placement="drawer" />
        </ShellProvider>,
      );
      act(() => probed.shell?.dispatch({ type: 'open-drawer', drawer: 'chats' }));
      await waitFor(() => expect(probed.shell?.state.drawer).toBe('chats'));
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(h.hideChatDrawer).not.toHaveBeenCalled();
      await waitFor(() => expect(probed.shell?.state.drawer).toBeNull());
    } finally {
      window.innerWidth = width;
    }
  });

  it('Open full screen carries what was typed to the chat screen', () => {
    h.chat = chatState('idle');
    const { unmount } = render(drawer());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'carry me over' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open full screen' }));
    expect(h.expandChatDrawer).toHaveBeenCalledTimes(1);
    unmount();
    render(sheet());
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('carry me over');
    // Handed over once: the next chat screen starts empty.
    cleanup();
    render(sheet());
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  });

  it('Open full screen waits while files are attached, and says so until they are removed', async () => {
    h.chat = chatState('idle');
    render(drawer());
    fireEvent.change(screen.getByLabelText('Choose files to attach'), {
      target: { files: [new File(['abcd'], 'brief.txt')] },
    });
    await screen.findByRole('button', { name: /Remove brief\.txt/ });
    fireEvent.click(screen.getByRole('button', { name: 'Open full screen' }));
    expect(h.expandChatDrawer).not.toHaveBeenCalled();
    expect(screen.getByText('Send or remove the attached files first.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Remove brief\.txt/ }));
    await waitFor(() => expect(screen.queryByText('Send or remove the attached files first.')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Open full screen' }));
    expect(h.expandChatDrawer).toHaveBeenCalledTimes(1);
  });

  it('the drawer header is the shared panel head, with its title, chip and both buttons', () => {
    h.chat = chatState('idle');
    const { container } = render(drawer());
    const head = container.querySelector('header');
    expect(head?.classList.contains('panel-head')).toBe(true);
    expect(head?.querySelector('h2')).toBeTruthy();
    const names = Array.from(head?.querySelectorAll('button') ?? []).map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Open full screen', 'Hide chat']);
  });

  it('Hide chat and Open full screen ask the store', () => {
    h.chat = chatState('working');
    render(drawer());
    fireEvent.click(screen.getByRole('button', { name: 'Hide chat' }));
    expect(h.hideChatDrawer).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Open full screen' }));
    expect(h.expandChatDrawer).toHaveBeenCalledTimes(1);
    // The message box is still there, so the person can carry on in the drawer.
    expect(screen.getByRole('textbox')).toBeTruthy();
  });
});

describe('the card waiting on you', () => {
  beforeEach(() => {
    h.composerFocus = 0;
    h.requestComposerFocus.mockReset();
    h.requestComposerFocus.mockImplementation(() => {
      h.composerFocus += 1;
    });
    api.answerPermission.mockClear();
  });

  const floater = () => document.querySelector('.floater') as HTMLElement;
  const thread = () => document.querySelector('.thread') as HTMLElement;
  const box = () => screen.getByRole('textbox', { name: 'Message to Claude' });
  const cardNamed = (title: string) => screen.getByRole('region', { name: title });

  it('shows once, above the message box, and moves to the thread once answered', async () => {
    const user: ChatItem = { kind: 'user', id: 'u', text: 'hi' };
    h.chat = withItems([user, perm('r1', 'Save a file')]);
    const { rerender } = render(sheet());

    expect(screen.getAllByText('Save a file')).toHaveLength(1);
    const card = cardNamed('Save a file');
    expect(floater().contains(card)).toBe(true);
    expect(thread().contains(card)).toBe(false);
    expect(card.compareDocumentPosition(box()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.activeElement).toBe(card);
    // While a card waits, the box says why it can't take a message.
    expect(box().getAttribute('placeholder')).toBe('Claude is waiting for your answer above.');

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(h.requestComposerFocus).toHaveBeenCalledTimes(1));

    h.chat = withItems([user, perm('r1', 'Save a file', 'allowed')]);
    rerender(sheet());
    expect(screen.queryByRole('region', { name: 'Save a file' })).toBeNull();
    expect(floater().querySelector('.pending')).toBeNull();
    expect(thread().textContent).toContain('You allowed this: Save a file');
    expect(document.activeElement).toBe(box());
  });

  it('with two waiting, shows the first; after an answer focus goes to the second, then to the message box', async () => {
    h.chat = withItems([perm('r1', 'First file'), perm('r2', 'Second file')]);
    const { rerender } = render(sheet());

    expect(screen.getAllByText('First file')).toHaveLength(1);
    expect(screen.queryByText('Second file')).toBeNull();
    expect(document.activeElement).toBe(cardNamed('First file'));

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(api.answerPermission).toHaveBeenCalledTimes(1));
    // Another card is waiting, so focus is not sent to the message box.
    expect(h.requestComposerFocus).not.toHaveBeenCalled();

    h.chat = withItems([perm('r1', 'First file', 'allowed'), perm('r2', 'Second file')]);
    rerender(sheet());
    const second = cardNamed('Second file');
    expect(floater().contains(second)).toBe(true);
    expect(document.activeElement).toBe(second);
    expect(thread().textContent).toContain('You allowed this: First file');

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(h.requestComposerFocus).toHaveBeenCalledTimes(1));
    h.chat = withItems([perm('r1', 'First file', 'allowed'), perm('r2', 'Second file', 'allowed')]);
    rerender(sheet());
    expect(floater().querySelector('.pending')).toBeNull();
    expect(document.activeElement).toBe(box());
  });

  it('shows a question in the same place', () => {
    h.chat = withItems([
      {
        kind: 'question',
        requestId: 'q1',
        outcome: null,
        questions: [
          {
            question: 'Which call?',
            header: '',
            multiSelect: false,
            options: [{ label: 'New', description: '' }],
          },
        ],
      },
    ]);
    render(sheet());
    const form = screen.getByRole('form', { name: 'Claude has a question for you' });
    expect(floater().contains(form)).toBe(true);
    expect(document.activeElement).toBe(form);
  });
});

describe('the level line under the message box', () => {
  const withLevel = (level: unknown, extra: object = {}) => ({
    ...chatState('idle'),
    model: 'claude-sonnet-5-5',
    effort: 'medium' as const,
    level,
    ...extra,
  });
  const auto = { tier: 'standard', source: { kind: 'auto', reason: 'A short writing job' } };

  it('replaces the engine line in automatic mode', () => {
    h.chat = withLevel(auto);
    render(sheet());
    const line = document.querySelector('.level-row');
    expect(line?.textContent).toContain('Standard · picked by the app for this chat');
    expect(line?.querySelector('strong')?.textContent).toBe('Standard');
    expect(screen.queryByRole('button', { name: 'Change model and effort' })).toBeNull();
  });

  it('keeps the v0.19.0 line with no level event, and in manual mode', () => {
    h.chat = withLevel(null);
    const { rerender } = render(sheet());
    expect(document.querySelector('.engine-text')?.textContent).toBe(
      'Claude is using Sonnet 5.5 · Medium effort',
    );
    h.chat = withLevel({ tier: null, source: { kind: 'manual' } });
    rerender(sheet());
    expect(document.querySelector('.engine-text')?.textContent).toBe(
      'Claude is using Sonnet 5.5 · Medium effort',
    );
    expect(screen.getByRole('button', { name: 'Change model and effort' })).toBeTruthy();
  });

  it('words team, chat and skill-own levels', () => {
    h.chat = withLevel({ tier: 'deep', source: { kind: 'team', skill: 'google-ads-audit' } });
    const { rerender } = render(sheet());
    expect(document.querySelector('.level-row')?.textContent).toContain(
      'Deep · for /google-ads-audit · team level',
    );
    h.chat = withLevel({ tier: 'quick', source: { kind: 'chat' } });
    rerender(sheet());
    expect(document.querySelector('.level-row')?.textContent).toContain('Quick · your choice for this chat');
    h.chat = withLevel({ tier: null, source: { kind: 'skill-own', skill: 'deep-dive' } });
    rerender(sheet());
    expect(document.querySelector('.level-row')?.textContent).toContain('Set by /deep-dive');
  });

  it('shows the reason, model and effort under Why?', () => {
    h.chat = withLevel(auto);
    render(sheet());
    const why = screen.getByRole('button', { name: 'Why?' });
    expect(why.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(why);
    expect(why.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('.level-why')?.textContent).toBe(
      'A short writing job It runs on Sonnet at medium effort.',
    );
  });

  it('the menu sets a tier for this chat, and goes back to automatic only after a choice', () => {
    h.chat = withLevel(auto);
    const { rerender } = render(sheet());
    fireEvent.click(screen.getByRole('button', { name: 'Change the level for this chat' }));
    expect(screen.queryByRole('button', { name: /Back to automatic/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Quick for this chat/ }));
    expect(h.setChatLevel).toHaveBeenCalledWith('s1', 'quick');
    h.chat = withLevel({ tier: 'quick', source: { kind: 'chat' } });
    rerender(sheet());
    fireEvent.click(screen.getByRole('button', { name: 'Change the level for this chat' }));
    fireEvent.click(screen.getByRole('button', { name: /Back to automatic/ }));
    expect(h.setChatLevel).toHaveBeenLastCalledWith('s1', null);
  });

  it('closes the menu with Escape and puts focus back on Change', () => {
    h.chat = withLevel(auto);
    render(sheet());
    const change = screen.getByRole('button', { name: 'Change the level for this chat' });
    fireEvent.click(change);
    fireEvent.keyDown(screen.getByRole('button', { name: /Deep for this chat/ }), { key: 'Escape' });
    expect(change.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(change);
  });
});

describe('the team-level offer', () => {
  const offerChat = () => ({
    ...chatState('idle'),
    level: { tier: 'standard', source: { kind: 'auto', reason: 'x' } },
    unlevelledSkill: 'write-post',
  });
  it('is shown to people who can set levels, and sets or dismisses', async () => {
    h.skillLevels = { levels: {}, canSet: true, writable: true };
    h.chat = offerChat();
    render(sheet());
    expect(screen.getByText('Set a team level for /write-post? This chat used Standard.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Deep' }));
    expect(h.setSkillLevel).toHaveBeenCalledWith('write-post', 'deep');
    await waitFor(() => expect(h.dismissLevelOffer).toHaveBeenCalledWith('s1'));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(h.dismissLevelOffer).toHaveBeenCalledTimes(2);
  });
  it('is hidden for the team, when not writable, and once the skill has a level', () => {
    h.chat = offerChat();
    for (const sl of [
      { levels: {}, canSet: false, writable: true },
      { levels: {}, canSet: true, writable: false },
      { levels: { 'write-post': { tier: 'quick', setBy: 'x', at: '' } }, canSet: true, writable: true },
      null,
    ]) {
      h.skillLevels = sl;
      const { unmount } = render(sheet());
      expect(screen.queryByText(/Set a team level/)).toBeNull();
      unmount();
    }
  });
});

// Watches what the shell shows when a link is clicked.
let shell: ReturnType<typeof useShell>['state'] | null = null;
function Probe() {
  shell = useShell().state;
  return null;
}

describe('a file link in a reply', () => {
  const withFiles = (pages: NonNullable<ChatState['files']['pages']>) => {
    const base = chatState('idle');
    h.chat = {
      ...base,
      files: {
        files: [
          {
            key: 'chart',
            path: 'personal/uc-chart.html',
            item: null,
            scope: { id: 'personal', name: 'My personal files', kind: 'personal' },
            actions: ['created'],
            toolUseIds: [],
            edits: 0,
            order: 1,
          },
        ],
        attachments: [],
        links: [],
        pages,
      },
      items: [{ kind: 'assistant', id: 'a', text: 'Made it: `personal/uc-chart.html`.', done: true }],
    } as ChatState;
    render(
      <ShellProvider>
        <ChatView />
        <Probe />
      </ShellProvider>,
    );
    return document.querySelector('a[href^="#chat-file="]') as HTMLAnchorElement;
  };

  it("opens the page view (with Download with TDS branding) when the file is this chat's page", () => {
    // A test on 15 Nov 2026: the link opened the plain file viewer, so the branding button was missing.
    const link = withFiles([
      {
        key: 'pg1',
        title: 'Chart',
        url: null,
        versions: [{ n: 1, remote: null, at: null, hasCopy: true }],
        draft: false,
        fileKey: 'chart',
        live: false,
        multiFile: false,
        toolUseIds: [],
        order: 1,
      },
    ]);
    fireEvent.click(link);
    expect(shell?.viewer).toEqual({ kind: 'page', chat: 's1', key: 'pg1' });
  });

  it('shows any other file in the Files panel as before', () => {
    fireEvent.click(withFiles([]));
    expect(shell?.viewer).toBeNull();
    expect(shell?.panelFile).toEqual({ chat: 's1', key: 'chart' });
  });
});

describe('the context meter and summarising line', () => {
  const reading = {
    type: 'context',
    usedTokens: 42_000,
    limitTokens: 100_000,
    windowTokens: 200_000,
    percent: 42,
    autoCompact: true,
    source: 'engine',
    at: 1,
  };

  it('stays hidden until the first reading', () => {
    h.chat = chatState('idle');
    render(sheet());
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('shows in manual mode, where the level line is not drawn', () => {
    h.chat = { ...chatState('idle'), level: { tier: null, source: { kind: 'manual' } }, context: reading };
    render(sheet());
    expect(document.querySelector('.level-row')).toBeNull();
    expect(screen.getByRole('meter', { name: 'How full this chat is' })).toBeTruthy();
  });

  it('shows beside the level line in automatic mode', () => {
    h.chat = {
      ...chatState('idle'),
      level: { tier: 'standard', source: { kind: 'auto', reason: 'x' } },
      context: reading,
    };
    render(sheet());
    expect(document.querySelector('.level-row')).not.toBeNull();
    expect(screen.getByRole('meter')).toBeTruthy();
  });

  it('says so while Claude summarises', () => {
    h.chat = { ...chatState('working'), compacting: true };
    render(sheet());
    expect(document.querySelector('.compacting-line')?.textContent).toBe(
      'Summarising the earlier conversation to make room…',
    );
  });

  it('says once that switching down is held back', () => {
    h.chat = {
      ...chatState('idle'),
      level: { tier: 'deep', kept: { wanted: 'quick' }, source: { kind: 'auto', reason: 'x' } },
    };
    render(sheet());
    expect(document.querySelector('.level-kept')?.textContent).toBe(
      'Staying on Deep for now: it costs less than switching down and re-reading the whole chat.',
    );
  });
});

describe('Save to project', () => {
  const SDK = '6127dcf1-a50e-43e0-bc6d-f370942a7e48';
  const card = (key: string, title: string) => ({
    key,
    title,
    slug: key.split('/')[1],
    client: key.split('/')[0],
    space: 'client',
    card: 'ok',
    archived: false,
    status: 'active',
  });
  const list = (canSaveChat: boolean) => ({
    canSaveChat,
    projects: [card('acme/site', 'Site'), card('acme/seo', 'SEO')],
  });
  const save = () => screen.queryByRole('button', { name: 'Save to project' });

  it('is hidden without canSaveChat', () => {
    h.chat = chatState('idle');
    h.live.sdkSessionId = SDK;
    h.projects = list(false);
    render(sheet());
    expect(save()).toBeNull();
  });

  it('is hidden while the chat has no sdkSessionId (nothing to save yet)', () => {
    h.chat = chatState('idle');
    h.projects = list(true);
    render(sheet());
    expect(save()).toBeNull();
  });

  it('is aria-disabled while Claude is replying, and pressing it does nothing', () => {
    h.chat = chatState('working');
    h.live.sdkSessionId = SDK;
    h.projects = list(true);
    render(sheet());
    const button = save() as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(saveChatRequest.get()).toBeNull();
    expect(screen.queryByLabelText('Save to')).toBeNull();
  });

  it('asks for a project when the chat has none, then sets the request and opens Projects with the chat beside it', () => {
    h.chat = chatState('idle');
    h.live.sdkSessionId = SDK;
    h.projects = list(true);
    render(sheet());
    fireEvent.click(save() as HTMLElement);
    expect(saveChatRequest.get()).toBeNull();
    pickOption('Save to', 'Site');
    expect(saveChatRequest.get()).toEqual({ key: 'acme/site', chat: SDK, title: 'T' });
    expect(projectPageRequest.get()).toBe('acme/site');
    expect(h.openView).toHaveBeenCalledWith('app:projects');
    expect(h.openChat).toHaveBeenCalledWith('s1', { in: 'drawer' });
  });

  it("uses the chat's own live project without asking", () => {
    h.chat = chatState('idle');
    h.live = { sdkSessionId: SDK, project: 'acme/seo' };
    h.projects = list(true);
    render(sheet());
    fireEvent.click(save() as HTMLElement);
    expect(screen.queryByLabelText('Save to')).toBeNull();
    expect(saveChatRequest.get()).toEqual({ key: 'acme/seo', chat: SDK, title: 'T' });
  });
});
