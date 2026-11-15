// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HelpTopic } from '../help/contract.ts';

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
  topic('welcome', 'Welcome', { area: 'getting-started', related: ['todos', 'nope'] }),
  topic('home', 'Home', { body: 'Start here. See [To-dos](help:todos).' }),
  topic('todos', 'To-dos', { area: 'todos', roles: ['owner', 'scout'], body: '![Alt](images/x.webp)' }),
];
const renderSpy = vi.hoisted(() => vi.fn());
vi.mock('../help/library.ts', async () => {
  const actual = await vi.importActual<typeof import('../help/library.ts')>('../help/library.ts');
  return { ...actual, helpLibrary: actual.createHelpLibrary(topics), helpImageUrl: () => '/x.webp' };
});
vi.mock('../help/render.ts', async () => {
  const actual = await vi.importActual<typeof import('../help/render.ts')>('../help/render.ts');
  return {
    renderHelp: (...args: Parameters<typeof actual.renderHelp>) => {
      renderSpy(...args);
      return actual.renderHelp(...args);
    },
  };
});

const { GuideView } = await import('./GuideView.tsx');
afterEach(cleanup);

describe('GuideView', () => {
  it('lists the areas and every page title in the contents, the first page current', () => {
    render(<GuideView />);
    const nav = screen.getByRole('navigation', { name: 'Contents' });
    // Area names label their lists (not headings), so the page title is the first heading after the bar.
    expect(within(nav).queryAllByRole('heading')).toHaveLength(0);
    expect(within(nav).getByRole('list', { name: 'Getting started' })).toBeTruthy();
    expect(within(nav).getByRole('list', { name: 'To-dos' })).toBeTruthy();
    expect(within(nav).getByRole('button', { name: 'Welcome' }).getAttribute('aria-current')).toBe('true');
    expect(within(nav).getByRole('button', { name: 'Home' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Welcome' })).toBeTruthy();
  });

  it('puts focus on the page heading when it opens', async () => {
    render(<GuideView />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2, name: 'Welcome' })).toBe(document.activeElement),
    );
  });

  it('shows the chosen page, with its badge', () => {
    render(<GuideView />);
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Contents' })).getByRole('button', { name: 'To-dos' }),
    );
    expect(screen.getByRole('heading', { level: 2, name: 'To-dos' })).toBeTruthy();
    expect(screen.getByText('For owners and scouts')).toBeTruthy();
  });

  it('a help link inside a page moves the guide to that page', () => {
    render(<GuideView />);
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Contents' })).getByRole('button', { name: 'Home' }),
    );
    const page = screen.getByRole('article');
    fireEvent.click(within(page).getByRole('link', { name: 'To-dos' }));
    expect(screen.getByRole('heading', { level: 2, name: 'To-dos' })).toBe(document.activeElement);
  });

  it('Related links (to pages that exist) move the page', () => {
    render(<GuideView />);
    const related = screen.getByRole('region', { name: 'Related' });
    expect(within(related).queryByRole('button', { name: 'nope' })).toBeNull();
    fireEvent.click(within(related).getByRole('button', { name: 'To-dos' }));
    expect(screen.getByRole('heading', { level: 2, name: 'To-dos' })).toBeTruthy();
  });

  it('the narrow picker holds every page and changes the page', () => {
    render(<GuideView />);
    const select = screen.getByRole('combobox', { name: 'Page' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Welcome', 'Home', 'To-dos']);
    fireEvent.change(select, { target: { value: 'home' } });
    expect(screen.getByRole('heading', { level: 2, name: 'Home' })).toBeTruthy();
  });

  it('keeps a print copy of every page, in order, with eager pictures', () => {
    const { container } = render(<GuideView />);
    const pages = [...container.querySelectorAll('.guide-print .guide-print-page')];
    expect(pages.map((p) => p.getAttribute('data-page'))).toEqual(['welcome', 'home', 'todos']);
    expect(container.querySelector('.guide-print img')?.getAttribute('loading')).toBeNull();
    expect(renderSpy).toHaveBeenCalledWith(expect.any(String), expect.any(Function), { eager: true });
  });

  it('has the root classes the screenshot scene uses', () => {
    const { container } = render(<GuideView />);
    expect(container.querySelector('.guide .guide-contents')).not.toBeNull();
    expect(container.querySelector('.guide .guide-page')).not.toBeNull();
  });
});
