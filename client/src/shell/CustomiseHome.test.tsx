// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeShortcut } from '../../../shared/contract.ts';

const h = vi.hoisted(() => ({
  hidden: [] as string[],
  shortcuts: [] as unknown[],
  hasGm: true,
  hasAds: true,
  hasSkills: true,
  setHomeItemShown: vi.fn(),
  addHomeShortcut: vi.fn(),
  removeHomeShortcut: vi.fn(),
  showAllHomeItems: vi.fn(),
  tools: [{ section: 'workbench', tool: 'ads', title: 'Ads Manager' }] as
    | { section: string; tool: string; title: string }[]
    | null,
}));

vi.mock('../store.tsx', () => ({
  useStore: () => ({
    homeHidden: h.hidden,
    homeShortcuts: h.shortcuts,
    setHomeItemShown: h.setHomeItemShown,
    addHomeShortcut: h.addHomeShortcut,
    removeHomeShortcut: h.removeHomeShortcut,
    showAllHomeItems: h.showAllHomeItems,
  }),
}));
vi.mock('./useHomeShortcuts.ts', () => ({
  useHomeShortcuts: () => ({
    hasGm: h.hasGm,
    hasAds: h.hasAds,
    hasSkills: h.hasSkills,
    sources: {
      tools: h.tools,
      toolTitle: (_s: string, t: string) =>
        ({ ads: 'Ads Manager', seo: 'SEO audit', report: 'Monthly report' })[t],
      places: [
        { id: 'projects', title: 'Projects' },
        { id: 'images', title: 'Images' },
      ],
      drawers: [{ id: 'todos', title: 'Tasks' }],
      actions: { openTool: vi.fn(), openPlace: vi.fn(), openDrawer: vi.fn() },
    },
  }),
}));

const { CustomiseHome } = await import('./CustomiseHome.tsx');

const tool = (name: string): HomeShortcut => ({ kind: 'tool', section: 'workbench', tool: name });
const six: HomeShortcut[] = ['a', 'b', 'c', 'd', 'e', 'f'].map(tool);

beforeEach(() => {
  h.hidden = [];
  h.shortcuts = [];
  h.hasGm = true;
  h.hasAds = true;
  h.hasSkills = true;
  h.tools = [
    { section: 'workbench', tool: 'ads', title: 'Ads Manager' },
    { section: 'workbench', tool: 'seo', title: 'SEO audit' },
    { section: 'workbench', tool: 'report', title: 'Monthly report' },
  ];
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('CustomiseHome', () => {
  it('has a named switch for each item, with hints linked', () => {
    render(<CustomiseHome />);
    expect(screen.getByText('Choose what shows on your Home. Only you see this.')).toBeTruthy();
    const files = screen.getByRole('switch', { name: 'Pinned files' }) as HTMLInputElement;
    expect(files.checked).toBe(true);
    const ads = screen.getByRole('switch', { name: 'Ads approvals' });
    expect(ads.getAttribute('aria-describedby')).not.toBeNull();
    const hint = document.getElementById(ads.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toContain('Shows only while an Ads change waits for you');
  });

  it('leaves out Start my day, Ads approvals and Pinned skills when they are not available', () => {
    h.hasGm = false;
    h.hasAds = false;
    h.hasSkills = false;
    render(<CustomiseHome />);
    expect(screen.queryByRole('switch', { name: 'Start my day' })).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Ads approvals' })).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Pinned skills' })).toBeNull();
    expect(screen.getByRole('switch', { name: 'Pinned files' })).toBeTruthy();
  });

  it('toggles an item and says so', () => {
    render(<CustomiseHome />);
    fireEvent.click(screen.getByRole('switch', { name: 'Pinned files' }));
    expect(h.setHomeItemShown).toHaveBeenCalledWith('files', false);
    expect(screen.getByRole('status').textContent).toBe('Pinned files hidden from Home');
  });

  it('shows a hidden item as off and announces it coming back', () => {
    h.hidden = ['files'];
    render(<CustomiseHome />);
    const sw = screen.getByRole('switch', { name: 'Pinned files' }) as HTMLInputElement;
    expect(sw.checked).toBe(false);
    fireEvent.click(sw);
    expect(h.setHomeItemShown).toHaveBeenCalledWith('files', true);
    expect(screen.getByRole('status').textContent).toBe('Pinned files shown on Home');
  });

  it('says what to do when there are no shortcuts', () => {
    render(<CustomiseHome />);
    expect(screen.getByText('Add a shortcut to open a tool, place or drawer in one click.')).toBeTruthy();
  });

  it('adds a shortcut from the grouped list, closes it and focuses the new row', () => {
    const { rerender } = render(<CustomiseHome />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a shortcut' }));
    const menu = screen.getByRole('menu', { name: 'Add a shortcut' });
    expect(within(menu).queryByText('Skills')).toBeNull();
    expect(within(menu).getByText('Tools')).toBeTruthy();
    expect(within(menu).queryByText('Start my day')).toBeNull();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Ads Manager' }));
    expect(h.addHomeShortcut).toHaveBeenCalledWith({ kind: 'tool', section: 'workbench', tool: 'ads' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Ads Manager added to Home');
    h.shortcuts = [{ kind: 'tool', section: 'workbench', tool: 'ads' }];
    rerender(<CustomiseHome />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Ads Manager from Home' }));
  });

  it('closes the list on Escape without leaving the panel, and returns focus to Add', () => {
    render(<CustomiseHome />);
    const add = screen.getByRole('button', { name: 'Add a shortcut' });
    fireEvent.click(add);
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'SEO audit' }), { key: 'Escape' });
    document.removeEventListener('keydown', outer);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(add);
  });

  it('closes the list on a click outside', () => {
    render(<CustomiseHome />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a shortcut' }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('disables Add at six, with the hint', () => {
    h.shortcuts = six;
    render(<CustomiseHome />);
    const add = screen.getByRole('button', { name: 'Add a shortcut' });
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('You have 6 shortcuts. Remove one to add another.')).toBeTruthy();
    fireEvent.click(add);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('marks a shortcut that has gone, and removes with focus on the next row', () => {
    h.shortcuts = [tool('seo'), tool('missing'), tool('report')];
    const { rerender } = render(<CustomiseHome />);
    expect(screen.getByText('No longer in your Brain')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove SEO audit from Home' }));
    expect(h.removeHomeShortcut).toHaveBeenCalledWith('tool:workbench/seo');
    expect(screen.getByRole('status').textContent).toBe('SEO audit removed from Home');
    h.shortcuts = [tool('missing'), tool('report')];
    rerender(<CustomiseHome />);
    expect(document.activeElement).toBe(screen.getAllByRole('button', { name: /^Remove / })[0]);
  });

  it('moves focus to Add when the last shortcut goes', () => {
    h.shortcuts = [tool('seo')];
    const { rerender } = render(<CustomiseHome />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove SEO audit from Home' }));
    h.shortcuts = [];
    rerender(<CustomiseHome />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add a shortcut' }));
  });

  it('shows everything again only when something is hidden', () => {
    const { rerender } = render(<CustomiseHome />);
    const btn = screen.getByRole('button', { name: 'Show everything again' });
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(btn);
    expect(h.showAllHomeItems).not.toHaveBeenCalled();
    h.hidden = ['files'];
    rerender(<CustomiseHome />);
    fireEvent.click(screen.getByRole('button', { name: 'Show everything again' }));
    expect(h.showAllHomeItems).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toBe('Every card is back on Home');
  });

  it('names a waiting tool shortcut by its title, with Tool as its meta', () => {
    h.tools = null;
    h.shortcuts = [{ kind: 'tool', section: 'workbench', tool: 'ads' }];
    render(<CustomiseHome />);
    expect(screen.getByText('Ads Manager')).toBeTruthy();
    expect(screen.getByText('Tool')).toBeTruthy();
    expect(screen.queryByText('ads')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Ads Manager from Home' }));
    expect(screen.getByRole('status').textContent).toBe('Ads Manager removed from Home');
  });

  it('offers places and drawers in their own groups, and names a row by its kind', () => {
    const { rerender } = render(<CustomiseHome />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a shortcut' }));
    const menu = screen.getByRole('menu', { name: 'Add a shortcut' });
    const groups = within(menu)
      .getAllByRole('group')
      .map((g) => g.getAttribute('aria-label'));
    expect(groups).toEqual(['Places', 'Drawers', 'Tools']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Tasks' }));
    expect(h.addHomeShortcut).toHaveBeenCalledWith({ kind: 'drawer', drawer: 'todos' });
    h.shortcuts = [
      { kind: 'drawer', drawer: 'todos' },
      { kind: 'place', place: 'projects' },
    ];
    rerender(<CustomiseHome />);
    expect(screen.getByText('Drawer')).toBeTruthy();
    expect(screen.getByText('Place')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Projects from Home' })).toBeTruthy();
  });

  it('disables Add, with a hint and no menu, when everything is already on Home', () => {
    h.tools = [{ section: 'workbench', tool: 'seo', title: 'SEO audit' }];
    h.shortcuts = [
      tool('seo'),
      { kind: 'place', place: 'projects' },
      { kind: 'place', place: 'images' },
      { kind: 'drawer', drawer: 'todos' },
    ];
    render(<CustomiseHome />);
    const add = screen.getByRole('button', { name: 'Add a shortcut' });
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Everything is already on your Home.')).toBeTruthy();
    fireEvent.click(add);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
