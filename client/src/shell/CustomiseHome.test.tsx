// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeShortcut } from '../../../shared/contract.ts';

const h = vi.hoisted(() => ({
  hidden: [] as string[],
  shortcuts: [] as unknown[],
  hasGm: true,
  hasAds: true,
  setHomeItemShown: vi.fn(),
  addHomeShortcut: vi.fn(),
  removeHomeShortcut: vi.fn(),
  showAllHomeItems: vi.fn(),
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
    sources: {
      skills: [
        { name: 'gm', title: 'Start my day' },
        { name: 'seo-audit', title: 'SEO audit' },
        { name: 'report', title: 'Monthly report' },
      ],
      tools: [{ section: 'workbench', tool: 'ads', title: 'Ads Manager' }],
      actions: { startSkill: vi.fn(), openTool: vi.fn() },
    },
  }),
}));

const { CustomiseHome } = await import('./CustomiseHome.tsx');

const skill = (name: string): HomeShortcut => ({ kind: 'skill', name });
const six: HomeShortcut[] = ['a', 'b', 'c', 'd', 'e', 'f'].map(skill);

beforeEach(() => {
  h.hidden = [];
  h.shortcuts = [];
  h.hasGm = true;
  h.hasAds = true;
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

  it('leaves out Start my day and Ads approvals when they are not available', () => {
    h.hasGm = false;
    h.hasAds = false;
    render(<CustomiseHome />);
    expect(screen.queryByRole('switch', { name: 'Start my day' })).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Ads approvals' })).toBeNull();
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
    expect(screen.getByText('Add a shortcut to start a skill or open a tool in one click.')).toBeTruthy();
  });

  it('adds a shortcut from the grouped list, closes it and focuses the new row', () => {
    const { rerender } = render(<CustomiseHome />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a shortcut' }));
    const menu = screen.getByRole('menu', { name: 'Add a shortcut' });
    expect(within(menu).getByText('Skills')).toBeTruthy();
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
    h.shortcuts = [skill('seo-audit'), skill('missing'), skill('report')];
    const { rerender } = render(<CustomiseHome />);
    expect(screen.getByText('No longer in your Brain')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove SEO audit from Home' }));
    expect(h.removeHomeShortcut).toHaveBeenCalledWith('skill:seo-audit');
    expect(screen.getByRole('status').textContent).toBe('SEO audit removed from Home');
    h.shortcuts = [skill('missing'), skill('report')];
    rerender(<CustomiseHome />);
    expect(document.activeElement).toBe(screen.getAllByRole('button', { name: /^Remove / })[0]);
  });

  it('moves focus to Add when the last shortcut goes', () => {
    h.shortcuts = [skill('seo-audit')];
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
});
