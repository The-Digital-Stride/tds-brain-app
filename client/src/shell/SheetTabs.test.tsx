// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SheetTabs } from './SheetTabs.tsx';
import type { SheetTabItem } from './settings-tabs.ts';

afterEach(cleanup);

const items: SheetTabItem[] = [
  { id: 'a', label: 'Alpha', count: 3 },
  { id: 'b', label: 'Beta', note: '2 due' },
  { id: 'c', label: 'Health', dot: 'bad', spoken: 'Health, 1 thing needs attention: Brain sync.' },
  { id: 'd', label: 'Delta' },
];

describe('SheetTabs', () => {
  it('names the nav, marks the current tab and no other', () => {
    render(<SheetTabs label="Settings sections" items={items} current="d" onChoose={() => {}} />);
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Delta' }).getAttribute('aria-current')).toBe('page');
  });

  it('shows a count, a note and a problem dot, and speaks them', () => {
    render(<SheetTabs label="Tabs" items={items} current="d" onChoose={() => {}} />);
    expect(
      screen.getByRole('button', { name: 'Alpha, 3 waiting' }).querySelector('.count')?.textContent,
    ).toBe('3');
    expect(screen.getByRole('button', { name: 'Beta, 2 due' }).textContent).toBe('Beta2 due');
    const health = screen.getByRole('button', { name: 'Health, 1 thing needs attention: Brain sync.' });
    expect(health.querySelector('.dot')?.getAttribute('data-state')).toBe('bad');
    // The dot's meaning is also the tooltip, and a tab with no dot has none.
    expect(health.getAttribute('data-tip')).toBe('Health, 1 thing needs attention: Brain sync.');
    expect(screen.getByRole('button', { name: 'Beta, 2 due' }).getAttribute('data-tip')).toBeNull();
  });

  it('chooses another tab on press, but not the current one', () => {
    const onChoose = vi.fn();
    render(<SheetTabs label="Tabs" items={items} current="d" onChoose={onChoose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delta' }));
    expect(onChoose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Beta, 2 due' }));
    expect(onChoose).toHaveBeenCalledWith('b');
  });

  it('adds the extra class', () => {
    render(
      <SheetTabs label="Tabs" items={items} current="a" className="tool-tabs seg" onChoose={() => {}} />,
    );
    expect(screen.getByRole('navigation').className).toBe('tool-tabs seg');
  });
});
