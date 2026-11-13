// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LibraryScope,
  LibrarySearchResponse,
  LiveSession,
  SkillInfo,
  TodoItem,
} from '../../../shared/contract.ts';
import { clientChoice } from '../state/client-choice.ts';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  sessions: vi.fn(),
  // The rail's last-sync stamp asks for this.
  sync: vi.fn(async () => ({ lastSync: null })),
  changelog: vi.fn(async () => ({ versions: [] })),
  startSession: vi.fn(),
  close: vi.fn(),
  updatePrefs: vi.fn(),
  librarySearch: vi.fn(),
  libraryScopes: vi.fn(),
  library: vi.fn(),
  libraryText: vi.fn(),
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
const { docsStore } = await import('../apps/documents/store.ts');
const { doc, SCOPES, listing } = await import('../apps/shared/testing.ts');

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
  appState: { kind: 'ready' as const },
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
  scope: 'tds',
  key: id,
  path: `todo/${id}`,
  handover: null,
  createdBy: null,
  title,
  created: null,
  source: null,
  details: '',
  version: 'v1',
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
const searchResponse = (over: Partial<LibrarySearchResponse> = {}): LibrarySearchResponse => ({
  hits: [],
  total: 0,
  partial: false,
  ...over,
});
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
  api.librarySearch.mockResolvedValue(searchResponse());
  api.libraryScopes.mockResolvedValue(SCOPES);
  api.library.mockImplementation(async (scope: string) => listing(scope, []));
});
afterEach(() => {
  cleanup();
  clientChoice.set('');
  docsStore.reset();
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
    expect(input().getAttribute('aria-label')).toBe('Search or jump to');
    expect(input().getAttribute('placeholder')).toBe('Search to-dos, chats, skills, files and more');
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
    // Home is first, so the second Up wraps to the last option: the pinned skill.
    expect(selectedLabel()).toBe('Meeting notes');
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

  it('shows a to-do in the drawer, and a second Enter on its row starts the chat with its link', async () => {
    await renderHome();
    await openPalette();
    fireEvent.click(screen.getByRole('option', { name: /Check the monthly reports/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const drawer = document.getElementById('drawer') as HTMLElement;
    await waitFor(() => expect(drawer.hasAttribute('inert')).toBe(false));
    expect(within(drawer).getByRole('heading', { name: 'To-dos' })).toBeTruthy();
    const row = within(drawer).getByText('Check the monthly reports', { exact: false }).closest('button');
    await waitFor(() => expect(document.activeElement).toBe(row));
    fireEvent.click(row as HTMLElement);
    await waitFor(() =>
      expect((screen.getByRole('textbox', { name: 'Message to Claude' }) as HTMLTextAreaElement).value).toBe(
        'Help me with this to-do: todo/t-today.md (Check the monthly reports)',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
    expect(api.startSession.mock.calls[0]?.[0]).toMatchObject({ todoId: 't-today.md' });
  });

  it('finds an open to-do too, and reveals it on the Open to anyone tab', async () => {
    api.todos.mockResolvedValue({
      ...todoList,
      open: [{ ...todo('o1.md', 'Pick up the audit', null), assignee: null }],
    });
    await renderHome();
    await openPalette();
    fireEvent.change(input(), { target: { value: 'audit' } });
    const option = screen.getByRole('option', { name: /Pick up the audit/ });
    expect(option.textContent).toContain('Open to anyone');
    fireEvent.click(option);
    const drawer = document.getElementById('drawer') as HTMLElement;
    await waitFor(() =>
      expect(
        within(drawer)
          .getByRole('radio', { name: /^Open to anyone/ })
          .getAttribute('aria-checked'),
      ).toBe('true'),
    );
    const row = within(drawer).getByText('Pick up the audit', { exact: false }).closest('button');
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  it('reveals a personal to-do by its key, then starts its chat with the personal path', async () => {
    api.todos.mockResolvedValue({
      ...todoList,
      mine: [
        {
          ...todo('p1.md', 'Private errand', null),
          scope: 'personal',
          key: 'personal/p1.md',
          path: 'personal/todo/p1.md',
        },
      ],
    });
    await renderHome();
    await openPalette();
    fireEvent.click(screen.getByRole('option', { name: /Private errand/ }));
    const drawer = document.getElementById('drawer') as HTMLElement;
    const row = await waitFor(() => {
      const r = within(drawer).getByText('Private errand', { exact: false }).closest('button');
      expect(document.activeElement).toBe(r);
      return r as HTMLElement;
    });
    fireEvent.click(row);
    await waitFor(() =>
      expect((screen.getByRole('textbox', { name: 'Message to Claude' }) as HTMLTextAreaElement).value).toBe(
        'Help me with this to-do: personal/todo/p1.md (Private errand)',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
    expect(api.startSession.mock.calls[0]?.[0]).toMatchObject({ todoId: 'personal/p1.md' });
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
    // The server-backed groups have not answered yet, so it is too soon to say nothing matches.
    expect(screen.getByText('Searching…')).toBeTruthy();
    await screen.findByText('Nothing matches');
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

describe('global search', () => {
  const docHit = (id: string, title: string) => ({
    item: doc({ id, title }),
    scope: SCOPES[1] as LibraryScope,
  });
  const labelsOf = () => options().map((o) => o.querySelector('.opt-label')?.textContent);
  const groupTitles = () =>
    screen
      .getAllByRole('group')
      .map((g) => g.querySelector('.grp > span')?.textContent)
      .filter(Boolean);

  it('opens with "/" from anywhere, but not while typing in a text field', async () => {
    await renderHome();
    const box = screen.getByRole('textbox', { name: 'Message to Claude' });
    box.focus();
    fireEvent.keyDown(box, { key: '/' });
    expect(screen.queryByRole('dialog')).toBeNull();
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: '/' });
    await screen.findByRole('dialog', { name: 'Search or jump to' });
  });

  it('lists Go to, To-dos, Open chats and Skills with nothing typed, apps in Go to', async () => {
    await renderHome();
    await openPalette();
    expect(groupTitles()).toEqual(['Go to', 'To-dos', 'Open chats', 'Skills']);
    expect(labelsOf().slice(0, 7)).toEqual([
      'Home',
      'To-dos',
      'Chats',
      'Skills',
      'Settings',
      'Images',
      'Documents',
    ]);
    expect(api.librarySearch).not.toHaveBeenCalledWith('', expect.anything(), expect.anything());
  });

  it('finds a client and shows Home on it', async () => {
    await renderHome();
    await openPalette();
    fireEvent.change(input(), { target: { value: 'north' } });
    expect(groupTitles()).toContain('Clients');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('option', { name: 'Northwind' }));
    await waitFor(() => expect(clientChoice.get()).toBe('client:northwind'));
    await screen.findByRole('heading', { level: 1, name: 'Home' });
  });

  it('finds an earlier chat by title and reopens it', async () => {
    api.sessions.mockResolvedValue({
      live: [],
      past: [{ sdkSessionId: 'sdk-1', title: 'Old SEO audit', lastModified: '2026-11-01T10:00:00Z' }],
    });
    api.startSession.mockResolvedValue({
      session: { ...chat('s9', 'Old SEO audit', 'idle'), sdkSessionId: 'sdk-1' },
    });
    await renderHome();
    await openPalette();
    fireEvent.change(input(), { target: { value: 'seo audit' } });
    expect(groupTitles()).toContain('Earlier chats');
    fireEvent.keyDown(input(), { key: 'Enter' });
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith({ resume: 'sdk-1' }));
  });

  it('adds files after the instant groups once the server answers, without moving the highlight', async () => {
    let answer!: (r: LibrarySearchResponse) => void;
    api.librarySearch.mockImplementation((_q: string, kind: string) =>
      kind === 'document'
        ? new Promise<LibrarySearchResponse>((res) => {
            answer = res;
          })
        : Promise.resolve(searchResponse()),
    );
    await renderHome();
    await openPalette();
    fireEvent.change(input(), { target: { value: 'report' } });
    expect(labelsOf()).toEqual(['Check the monthly reports', 'Monthly reports check']);
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(selectedLabel()).toBe('Monthly reports check');
    await waitFor(() => expect(answer).toBeDefined(), { timeout: 2000 });
    await act(async () =>
      answer(searchResponse({ hits: [docHit('client:acme.d1', 'October report')], total: 1 })),
    );
    expect(groupTitles().at(-1)).toBe('Documents');
    expect(labelsOf().at(-1)).toBe('October report');
    expect(options().at(-1)?.textContent).toContain('Acme Heating Ltd');
    // The highlight stayed on the same option.
    expect(selectedLabel()).toBe('Monthly reports check');
    expect(api.librarySearch).toHaveBeenCalledWith('report', 'document', { signal: expect.any(AbortSignal) });
    expect(api.librarySearch).toHaveBeenCalledWith('report', 'image', { signal: expect.any(AbortSignal) });
  });

  it('drops a slow answer to a query the person has typed past', async () => {
    const pending: ((r: LibrarySearchResponse) => void)[] = [];
    api.librarySearch.mockImplementation((_q: string, kind: string) =>
      kind === 'document'
        ? new Promise<LibrarySearchResponse>((res) => pending.push(res))
        : Promise.resolve(searchResponse()),
    );
    await renderHome();
    await openPalette();
    fireEvent.change(input(), { target: { value: 'rep' } });
    await waitFor(() => expect(pending).toHaveLength(1), { timeout: 2000 });
    fireEvent.change(input(), { target: { value: 'repo' } });
    await waitFor(() => expect(pending).toHaveLength(2), { timeout: 2000 });
    const firstSignal = api.librarySearch.mock.calls.find((c) => c[0] === 'rep' && c[1] === 'document')?.[2]
      ?.signal as AbortSignal;
    expect(firstSignal.aborted).toBe(true);
    await act(async () => pending[0]?.(searchResponse({ hits: [docHit('x', 'Stale hit')], total: 1 })));
    expect(screen.queryByText('Stale hit')).toBeNull();
    await act(async () => pending[1]?.(searchResponse({ hits: [docHit('y', 'Fresh hit')], total: 1 })));
    expect(screen.getByText('Fresh hit')).toBeTruthy();
    expect(screen.queryByText('Stale hit')).toBeNull();
  });

  it('says "6 of N" on a cut-short group, and marks personal files', async () => {
    const hits = Array.from({ length: 6 }, (_, i) => docHit(`client:acme.d${i}`, `Plan ${i}`));
    hits[0] = { item: doc({ id: 'personal.p1', title: 'Plan secret' }), scope: SCOPES[0] as LibraryScope };
    api.librarySearch.mockImplementation(async (_q: string, kind: string) =>
      kind === 'document' ? searchResponse({ hits, total: 23 }) : searchResponse(),
    );
    await renderHome();
    await openPalette();
    fireEvent.change(input(), { target: { value: 'plan' } });
    await screen.findByText('Plan 3');
    const group = screen.getByRole('group', { name: 'Documents 6 of 23' });
    expect(within(group).getByText('6 of 23')).toBeTruthy();
    expect(within(group).getByText('Plan secret').closest('.opt')?.textContent).toContain(
      'My personal files',
    );
  });

  const partialThenFound = () =>
    api.librarySearch.mockImplementation(async (_q: string, kind: string) => {
      if (kind !== 'document') return searchResponse();
      const asked = api.librarySearch.mock.calls.filter(
        (c) => c[0] === 'report' && c[1] === 'document',
      ).length;
      return asked === 1
        ? searchResponse({ partial: true })
        : searchResponse({ hits: [docHit('client:acme.d1', 'Report found later')], total: 1 });
    });

  it('says "Still looking…" at the foot while the server builds more, then shows what turns up', async () => {
    partialThenFound();
    await renderHome();
    await openPalette();
    fireEvent.change(input(), { target: { value: 'report' } });
    await screen.findByText('Still looking…', {}, { timeout: 2000 });
    // No heading stands alone for the group that has nothing yet.
    expect(groupTitles()).not.toContain('Documents');
    await screen.findByText('Report found later', {}, { timeout: 3000 });
    expect(screen.queryByText('Still looking…')).toBeNull();
  });

  it('says "Searching…", and announces nothing, while only a partial answer without hits has come', async () => {
    api.librarySearch.mockImplementation(async (_q: string, kind: string) =>
      kind === 'document' ? searchResponse({ partial: true }) : searchResponse(),
    );
    await renderHome();
    await openPalette();
    fireEvent.change(input(), { target: { value: 'zzzz' } });
    await waitFor(
      () => expect(api.librarySearch).toHaveBeenCalledWith('zzzz', 'document', expect.anything()),
      {
        timeout: 2000,
      },
    );
    await new Promise((r) => setTimeout(r, 700));
    expect(screen.getByText('Searching…')).toBeTruthy();
    expect(screen.queryByText('Nothing matches')).toBeNull();
    expect(screen.queryByRole('group')).toBeNull();
    expect(
      within(screen.getByRole('dialog'))
        .getAllByRole('status')
        .map((n) => n.textContent)
        .join(''),
    ).toBe('');
  });

  it('announces results once while still looking and once when done, not on each retry', async () => {
    partialThenFound();
    await renderHome();
    await openPalette();
    const status = within(screen.getByRole('dialog')).getAllByRole('status')[0] as HTMLElement;
    const said: string[] = [];
    const watch = new MutationObserver(() => {
      if (status.textContent) said.push(status.textContent);
    });
    watch.observe(status, { childList: true, characterData: true, subtree: true });
    fireEvent.change(input(), { target: { value: 'report' } });
    await waitFor(() => expect(said).toContain('3 results'), { timeout: 4000 });
    watch.disconnect();
    expect(said).toEqual(['2 results, still looking for more', '3 results']);
  });

  it('says it could not search files, rather than "Nothing matches", when the server search fails', async () => {
    api.librarySearch.mockRejectedValue(new Error('down'));
    await renderHome();
    await openPalette();
    fireEvent.change(input(), { target: { value: 'zzzz' } });
    await screen.findByText("Couldn't search files just now", {}, { timeout: 2000 });
    expect(screen.queryByText('Nothing matches')).toBeNull();
  });

  it('with other results, notes on the files group that it could not search', async () => {
    api.librarySearch.mockImplementation(async (_q: string, kind: string) => {
      if (kind === 'document') throw new Error('down');
      return searchResponse();
    });
    await renderHome();
    await openPalette();
    fireEvent.change(input(), { target: { value: 'report' } });
    const group = await screen.findByRole('group', { name: 'Documents' }, { timeout: 2000 });
    expect(within(group).getByText("Couldn't search")).toBeTruthy();
    expect(within(group).queryAllByRole('option')).toHaveLength(0);
    expect(labelsOf()).toEqual(['Check the monthly reports', 'Monthly reports check']);
  });

  it('opens a file in its app: the folder, the item chosen and the viewer if it can be viewed', async () => {
    const report = doc({ id: 'client:northwind.d1', title: 'Board report', view: 'text' });
    api.librarySearch.mockImplementation(async (_q: string, kind: string) =>
      kind === 'document'
        ? searchResponse({ hits: [{ item: report, scope: SCOPES[2] as LibraryScope }], total: 1 })
        : searchResponse(),
    );
    api.library.mockImplementation(async (scope: string) =>
      listing(scope, scope === 'client:northwind' ? [report] : []),
    );
    api.libraryText.mockResolvedValue({ text: 'Hello', truncated: false });
    await renderHome();
    await openPalette();
    fireEvent.change(input(), { target: { value: 'board' } });
    fireEvent.click(await screen.findByRole('option', { name: /Board report/ }, { timeout: 2000 }));
    await screen.findByRole('heading', { level: 1, name: 'Documents' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(docsStore.get()).toMatchObject({ scope: 'client:northwind', current: report, viewing: report });
  });

  describe('tooltips', () => {
    const tip = () => document.querySelector<HTMLElement>('.palette-tip');
    const tipText = () => [...(tip()?.querySelectorAll('p') ?? [])].map((p) => p.textContent);
    const answerDocs = () =>
      api.librarySearch.mockImplementation(async (_q: string, kind: string) =>
        kind === 'document'
          ? searchResponse({ hits: [docHit('client:acme.d1', 'October report for the board')], total: 1 })
          : searchResponse(),
      );
    const FULL = [
      'October report for the board',
      '2026-11-03-october-report.pdf',
      'Acme Heating Ltd · Reports',
      'PDF · 840 KB · Changed 5 Nov 2026',
      'clients/acme/reports/2026-11-03-october-report.pdf',
    ];

    // The server's answer ignores the query: "report" also finds a to-do and a chat, "october" only the file.
    const fileRow = async (query = 'october') => {
      answerDocs();
      await renderHome();
      await openPalette();
      fireEvent.change(input(), { target: { value: query } });
      return screen.findByRole('option', { name: /October report/ }, { timeout: 2000 });
    };
    const pause = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

    it("show a file's full details on hover, after a moment, and hide on leaving", async () => {
      const row = await fileRow();
      fireEvent.mouseMove(row);
      expect(tip()).toBeNull();
      await waitFor(() => expect(tipText()).toEqual(FULL));
      // Drawn outside the dialog, so the clipped panel never cuts it off; hidden from screen readers.
      expect(screen.getByRole('dialog').contains(tip())).toBe(false);
      expect(tip()?.getAttribute('aria-hidden')).toBe('true');
      fireEvent.mouseLeave(row);
      await waitFor(() => expect(tip()).toBeNull());
    });

    it('stay while the pointer moves from the row onto the tooltip, and go when it leaves that too', async () => {
      const row = await fileRow();
      fireEvent.mouseMove(row);
      await waitFor(() => expect(tip()).not.toBeNull());
      fireEvent.mouseLeave(row);
      fireEvent.mouseEnter(tip() as HTMLElement);
      await pause(300);
      expect(tipText()).toEqual(FULL);
      fireEvent.mouseLeave(tip() as HTMLElement);
      await waitFor(() => expect(tip()).toBeNull());
    });

    it('put away with one Escape, and a second Escape closes the search', async () => {
      const row = await fileRow();
      fireEvent.mouseMove(row);
      await waitFor(() => expect(tip()).not.toBeNull());
      fireEvent.keyDown(input(), { key: 'Escape' });
      expect(tip()).toBeNull();
      expect(screen.getByRole('dialog')).toBeTruthy();
      fireEvent.keyDown(input(), { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('with no tooltip up, Escape closes the search at once', async () => {
      await fileRow();
      fireEvent.keyDown(input(), { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('follow the arrows rather than a pointer resting on another row, and go when typing', async () => {
      const row = await fileRow('report');
      const rows = options();
      const other = rows.find((o) => o !== row) as HTMLElement;
      const label = other.querySelector('.opt-label') as HTMLElement;
      Object.defineProperty(label, 'scrollWidth', { configurable: true, value: 900 });
      Object.defineProperty(label, 'clientWidth', { configurable: true, value: 300 });
      fireEvent.mouseMove(other);
      await waitFor(() => expect(tipText()[0]).toBe(label.textContent));
      // Arrow until the file row is highlighted: its tooltip, not the pointed-at row's.
      for (let i = 0; i < rows.length && selectedLabel() !== 'October report for the board'; i++) {
        fireEvent.keyDown(input(), { key: 'ArrowDown' });
      }
      await waitFor(() => expect(tipText()[0]).toBe('October report for the board'));
      fireEvent.change(input(), { target: { value: 'repor' } });
      expect(tip()).toBeNull();
    });

    it("give screen readers a file's details as the row's description", async () => {
      answerDocs();
      await renderHome();
      await openPalette();
      fireEvent.change(input(), { target: { value: 'october' } });
      const row = await screen.findByRole('option', { name: /October report/ }, { timeout: 2000 });
      const desc = document.getElementById(row.getAttribute('aria-describedby') ?? '');
      // Not the path: it would be read out on every arrow press.
      expect(desc?.textContent).toBe(FULL.slice(1, -1).join('. '));
      // The name stays the row's own words, not the details.
      expect(row.querySelector('.opt-label')?.textContent).toBe('October report for the board');
      expect(within(screen.getByRole('dialog')).queryByRole('option', { name: /840 KB/ })).toBeNull();
    });

    it('never show for a highlighted row that fits', async () => {
      await renderHome();
      await openPalette();
      fireEvent.change(input(), { target: { value: 'sett' } });
      fireEvent.keyDown(input(), { key: 'ArrowDown' });
      await pause(450);
      expect(selectedLabel()).toBe('Settings');
      expect(tip()).toBeNull();
    });

    it('show the full words of any row cut short by the box', async () => {
      await renderHome();
      await openPalette();
      fireEvent.change(input(), { target: { value: 'monthly' } });
      const row = within(screen.getByRole('dialog')).getByRole('option', {
        name: /Check the monthly reports/,
      });
      const label = row.querySelector('.opt-label') as HTMLElement;
      Object.defineProperty(label, 'scrollWidth', { configurable: true, value: 900 });
      Object.defineProperty(label, 'clientWidth', { configurable: true, value: 300 });
      fireEvent.mouseMove(row);
      await waitFor(() =>
        expect(tipText()).toEqual(['Check the monthly reports', 'Acme Heating, due today']),
      );
      expect(row.getAttribute('aria-describedby')).toBeNull();
    });
  });

  it('says how many results there are, once the list settles', async () => {
    await renderHome();
    await openPalette();
    fireEvent.change(input(), { target: { value: 'sett' } });
    await waitFor(
      () =>
        expect(
          within(screen.getByRole('dialog'))
            .getAllByRole('status')
            .map((n) => n.textContent),
        ).toContain('1 result'),
      { timeout: 3000 },
    );
  });

  it('keeps working when the server search fails', async () => {
    api.librarySearch.mockRejectedValue(new Error('down'));
    await renderHome();
    await openPalette();
    fireEvent.change(input(), { target: { value: 'settings' } });
    await waitFor(() => expect(screen.queryByText('Searching…')).toBeNull());
    expect(labelsOf()).toEqual(['Settings']);
  });
});
