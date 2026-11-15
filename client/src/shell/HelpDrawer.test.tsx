// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HelpTopic } from '../help/contract.ts';

const store = vi.hoisted(() => ({ openView: vi.fn() }));
vi.mock('../store.tsx', () => ({ useStore: () => store }));
const dispatch = vi.hoisted(() => vi.fn());
const shell = vi.hoisted(() => ({ state: { drawer: 'help', helpPage: 'home' } as Record<string, unknown> }));
vi.mock('./ShellProvider.tsx', () => ({
  useShell: () => ({ state: shell.state, dispatch, modes: { drawerOverlays: false } }),
}));

const topic = (id: string, title: string, over: Partial<HelpTopic> = {}): HelpTopic => ({
  id,
  title,
  area: 'home',
  order: 1,
  summary: `About ${title}`,
  benefit: 'It helps.',
  roles: 'all',
  related: [],
  since: '0.36.0',
  reviewed: '2026-11-20',
  body: `Words for ${title}.`,
  ...over,
});
const topics = [
  topic('welcome', 'Welcome'),
  topic('home', 'Home', { body: 'Start here. See [To-dos](help:todos).' }),
  topic('todos', 'To-dos', { area: 'todos', roles: ['owner', 'scout'] }),
  topic('owners', 'Owners', { area: 'settings', roles: ['owner'] }),
];
vi.mock('../help/library.ts', async () => {
  const actual = await vi.importActual<typeof import('../help/library.ts')>('../help/library.ts');
  return { ...actual, helpLibrary: actual.createHelpLibrary(topics), helpImageUrl: () => null };
});

const { HelpDrawer } = await import('./HelpDrawer.tsx');

beforeEach(() => {
  shell.state = { drawer: 'help', helpPage: 'home' };
});
afterEach(cleanup);

describe('HelpDrawer', () => {
  it('opens the Cortex Guide by closing the drawer (not Help) and showing the guide view', () => {
    render(<HelpDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Open the Cortex Guide' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'close-drawer' });
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'close-help' });
    expect(store.openView).toHaveBeenCalledWith('guide');
  });

  it('starts afresh when Help is opened again on the same page', () => {
    shell.state = { drawer: 'help', helpPage: 'home', helpOpened: 1 };
    const { rerender } = render(<HelpDrawer />);
    fireEvent.click(screen.getByRole('link', { name: 'To-dos' }));
    expect(screen.getByRole('heading', { name: 'To-dos' })).toBeTruthy();
    shell.state = { drawer: 'help', helpPage: 'home', helpOpened: 2 };
    rerender(<HelpDrawer />);
    expect(screen.getByRole('heading', { name: 'Home' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('shows the page for where you are, with its title and words', () => {
    render(<HelpDrawer />);
    expect(screen.getByRole('heading', { name: 'Home' })).toBeTruthy();
    expect(screen.getByText(/Start here/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(screen.queryByText('For owners and scouts')).toBeNull();
  });

  it('falls back to the welcome page for an unknown page', () => {
    shell.state = { drawer: 'help', helpPage: 'nope' };
    render(<HelpDrawer />);
    expect(screen.getByRole('heading', { name: 'Welcome' })).toBeTruthy();
  });

  it('opens a linked page, shows the owner badge, and Back returns', () => {
    render(<HelpDrawer />);
    fireEvent.click(screen.getByRole('link', { name: 'To-dos' }));
    const heading = screen.getByRole('heading', { name: 'To-dos' });
    expect(heading).toBeTruthy();
    expect(screen.getByText('For owners and scouts')).toBeTruthy();
    expect(document.activeElement).toBe(heading);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Home' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('lists each area as its own shut fold after the page, and a row opens its page', () => {
    render(<HelpDrawer />);
    expect(screen.queryByRole('button', { name: /All help pages/ })).toBeNull();
    const area = screen.getByRole('button', { name: /^To-dos\s*1$/ });
    expect(area.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(area);
    fireEvent.click(screen.getByText('About To-dos').closest('button') as HTMLElement);
    expect(screen.getByRole('heading', { name: 'To-dos' })).toBeTruthy();
  });

  it('names who a page is for', () => {
    shell.state = { drawer: 'help', helpPage: 'todos' };
    const { unmount } = render(<HelpDrawer />);
    expect(screen.getByText('For owners and scouts')).toBeTruthy();
    unmount();
    shell.state = { drawer: 'help', helpPage: 'owners' };
    render(<HelpDrawer />);
    expect(screen.getByText('For owners')).toBeTruthy();
  });

  it('announces how many pages match a search', () => {
    render(<HelpDrawer />);
    const box = screen.getByRole('searchbox', { name: 'Search help' });
    fireEvent.change(box, { target: { value: 'welcome' } });
    expect(screen.getByRole('status').textContent).toBe('1 help page matches');
    fireEvent.change(box, { target: { value: 'zzzz' } });
    expect(screen.getByRole('status').textContent).toBe('No help pages match that search.');
  });

  it('search replaces the page and the list, and says so when nothing matches', () => {
    render(<HelpDrawer />);
    const box = screen.getByRole('searchbox', { name: 'Search help' });
    fireEvent.change(box, { target: { value: 'welcome' } });
    expect(screen.queryByRole('heading', { name: 'Home' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^To-dos\s*1$/ })).toBeNull();
    const hit = screen.getByText('About Welcome');
    fireEvent.click(hit);
    expect(screen.getByRole('heading', { name: 'Welcome' })).toBeTruthy();
    fireEvent.change(box, { target: { value: 'zzzz' } });
    expect(screen.getAllByText('No help pages match that search.')).toHaveLength(2);
  });

  it('starts again on the new page when Help is opened on another one', () => {
    const { rerender } = render(<HelpDrawer />);
    fireEvent.click(screen.getByRole('link', { name: 'To-dos' }));
    shell.state = { drawer: 'help', helpPage: 'welcome' };
    rerender(<HelpDrawer />);
    const head = screen.getByRole('heading', { name: 'Welcome' });
    expect(within(head.closest('section') as HTMLElement).queryByRole('button', { name: 'Back' })).toBeNull();
  });
});
