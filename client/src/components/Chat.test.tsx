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
}));
const api = vi.hoisted(() => ({
  answerPermission: vi.fn().mockResolvedValue({ ok: true }),
  answerQuestion: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('../api.ts', () => ({ api }));
vi.mock('../store.tsx', () => ({
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
      live: [{ id: 's1', title: 'T', client: null, sdkSessionId: null, lastActivityAt: h.lastActivityAt }],
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
  }),
}));

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
  h.setSkillLevel.mockClear();
  h.dismissLevelOffer.mockClear();
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
    expect(screen.getByRole('button', { name: 'Close chat' })).toBeTruthy();
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
