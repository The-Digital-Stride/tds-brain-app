// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveSession, SkillInfo, TodoItem } from '../../../shared/contract.ts';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  sessions: vi.fn(),
  // The rail's last-sync stamp asks for this.
  sync: vi.fn(async () => ({ lastSync: null })),
  startSession: vi.fn(),
  close: vi.fn(),
  updatePrefs: vi.fn(),
}));
vi.mock('../api.ts', () => ({
  api,
  streamUrl: () => '/api/stream',
  ApiFailure: class extends Error {},
}));

class FakeEventSource {
  static CLOSED = 2;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener() {}
  close() {
    this.readyState = 2;
  }
}

const { App } = await import('../App.tsx');

const skill = (name: string, title: string): SkillInfo => ({
  name,
  title,
  description: '',
  kind: 'skill',
  maturity: 'live',
  argumentHint: null,
  restrictedTo: null,
});

const boot = {
  appVersion: '0',
  service: { underService: true },
  identity: { name: 'Sam Example', slug: 'sam-example', email: null, role: 'team', knownMember: true },
  brain: { ok: true, path: '/brain', problems: [] },
  engine: { ok: true, claudePath: '/bin/claude', problem: null, permissionMode: 'default' },
  skills: [skill('meeting-notes', 'Meeting notes'), skill('standup', 'Standup')],
  clients: [
    { slug: 'acme', name: 'Acme Heating' },
    { slug: 'northwind', name: 'Northwind' },
  ],
  usedOften: [],
  prefs: { pins: ['meeting-notes'], lastClient: null, todoPanelOpen: false, directWrites: false },
};

function dayOffset(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const todo = (id: string, title: string, due: string | null, client: string | null = null): TodoItem => ({
  id,
  title,
  assignee: 'sam-example',
  due,
  surfaceDate: null,
  project: null,
  client,
});
const chat = (
  id: string,
  title: string,
  state: LiveSession['state'],
  todoId: string | null = null,
): LiveSession => ({
  id,
  sdkSessionId: null,
  title,
  client: null,
  todoId,
  state,
  startedAt: '',
  lastActivityAt: '2026-11-11T10:00:00.000Z',
});

const todoList = {
  mine: [todo('t-today.md', 'Check the monthly reports', dayOffset(0), 'acme')],
  open: [],
  othersCount: 0,
};

async function renderHome() {
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: 'Home' });
  const box = screen.getByRole('textbox', { name: 'Message to Claude' });
  await waitFor(() => expect(document.activeElement).toBe(box));
  await screen.findByText('Check the monthly reports', { exact: false }).catch(() => null);
}
const jump = () => screen.getByRole('button', { name: 'Search or jump to' });
const desk = () => document.querySelector('.desk') as HTMLElement;
const input = () => within(screen.getByRole('dialog')).getByRole('combobox') as HTMLInputElement;
const options = () => within(screen.getByRole('dialog')).queryAllByRole('option');
const selectedLabel = () =>
  document.getElementById(input().getAttribute('aria-activedescendant') ?? '')?.querySelector('.opt-label')
    ?.textContent;

async function openPalette() {
  jump().focus();
  fireEvent.click(jump());
  await screen.findByRole('dialog', { name: 'Search or jump to' });
}

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  api.bootstrap.mockResolvedValue(boot);
  api.todos.mockResolvedValue(todoList);
  api.sessions.mockResolvedValue({
    live: [{ ...chat('s1', 'Monthly reports check', 'waiting'), client: 'acme' }],
    past: [],
  });
  api.startSession.mockResolvedValue({ session: chat('new1', 'New chat', 'working') });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
});

describe('Palette', () => {
  it('is not rendered while shut', async () => {
    await renderHome();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens from the button with the input focused, a modal dialog and the desk inert', async () => {
    await renderHome();
    await openPalette();
    const dialog = screen.getByRole('dialog', { name: 'Search or jump to' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(input()));
    expect(input().getAttribute('aria-expanded')).toBe('true');
    expect(input().getAttribute('placeholder')).toBe('Search skills, to-dos and chats');
    expect(input().getAttribute('aria-controls')).toBe(screen.getByRole('listbox').id);
    expect(desk().hasAttribute('inert')).toBe(true);
    expect(
      screen
        .getAllByRole('group')
        .map((g) => g.getAttribute('aria-labelledby'))
        .every(Boolean),
    ).toBe(true);
    expect(options()[0]?.getAttribute('aria-selected')).toBe('true');
  });

  it('opens with Cmd+K and Ctrl+K, and toggles shut', async () => {
    await renderHome();
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    await screen.findByRole('dialog');
    fireEvent.keyDown(input(), { key: 'k', ctrlKey: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    await screen.findByRole('dialog');
  });

  it('moves with the arrows, wrapping, and Enter runs the option (opens a drawer)', async () => {
    await renderHome();
    await openPalette();
    expect(selectedLabel()).toBe('Home');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(selectedLabel()).toBe('To-dos');
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(selectedLabel()).toBe('Check the monthly reports');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(selectedLabel()).toBe('Home');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const drawer = document.getElementById('drawer') as HTMLElement;
    await waitFor(() => expect(drawer.hasAttribute('inert')).toBe(false));
    expect(within(drawer).getByRole('heading', { name: 'To-dos' })).toBeTruthy();
    expect(desk().hasAttribute('inert')).toBe(false);
  });

  it('runs a chat option with a click', async () => {
    await renderHome();
    await openPalette();
    fireEvent.click(screen.getByRole('option', { name: /Monthly reports check/ }));
    await screen.findByRole('heading', { level: 1, name: 'Monthly reports check' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('starts a chat on a to-do with its link, and a skill from the list', async () => {
    await renderHome();
    await openPalette();
    fireEvent.click(screen.getByRole('option', { name: /Check the monthly reports/ }));
    await waitFor(() =>
      expect((screen.getByRole('textbox', { name: 'Message to Claude' }) as HTMLTextAreaElement).value).toBe(
        'Help me with this to-do: todo/t-today.md (Check the monthly reports)',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
    expect(api.startSession.mock.calls[0]?.[0]).toMatchObject({ todoId: 't-today.md' });
  });

  it('starts a skill and puts focus in the message box', async () => {
    await renderHome();
    await openPalette();
    fireEvent.click(screen.getByRole('option', { name: 'Meeting notes' }));
    await screen.findByText('Meeting notes', { selector: 'strong' });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message to Claude' })),
    );
  });

  it('filters as you type, resets to the first option, and says when nothing matches', async () => {
    await renderHome();
    await openPalette();
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.change(input(), { target: { value: 'sett' } });
    expect(options().map((o) => o.querySelector('.opt-label')?.textContent)).toEqual(['Settings']);
    expect(selectedLabel()).toBe('Settings');
    fireEvent.change(input(), { target: { value: 'zzzz' } });
    expect(options()).toHaveLength(0);
    expect(screen.getByText('Nothing matches')).toBeTruthy();
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('opens Settings from the palette', async () => {
    await renderHome();
    await openPalette();
    fireEvent.change(input(), { target: { value: 'settings' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await screen.findAllByRole('heading', { name: 'Settings' });
  });

  it('closes on Esc and a click on the veil, and focus returns to where it was', async () => {
    await renderHome();
    await openPalette();
    fireEvent.keyDown(input(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(jump());
    expect(desk().hasAttribute('inert')).toBe(false);

    await openPalette();
    fireEvent.click(document.querySelector('.palette-veil') as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(jump());
  });

  it('keeps Tab and Shift+Tab inside', async () => {
    await renderHome();
    await openPalette();
    expect(fireEvent.keyDown(input(), { key: 'Tab' })).toBe(false);
    expect(fireEvent.keyDown(input(), { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(input());
  });

  it('shows client names, not folder slugs, as hints', async () => {
    await renderHome();
    await openPalette();
    const text = within(screen.getByRole('dialog')).getByRole('listbox').textContent ?? '';
    expect(text).toContain('Acme Heating');
    expect(text).not.toMatch(/\bacme\b/);
    expect(options().find((o) => o.textContent?.includes('Monthly'))?.textContent).toContain('Acme Heating');
  });

  it('shows the T, C, S key hints', async () => {
    await renderHome();
    await openPalette();
    expect(document.querySelectorAll('.palette kbd')).toHaveLength(3);
  });

  it('drops the key hints when single-key shortcuts are off', async () => {
    localStorage.setItem('tds-brain-shell', JSON.stringify({ singleKeys: false }));
    await renderHome();
    await openPalette();
    expect(document.querySelectorAll('.palette kbd')).toHaveLength(0);
    expect(options().map((o) => o.querySelector('.opt-label')?.textContent)).toContain('To-dos');
  });
});
