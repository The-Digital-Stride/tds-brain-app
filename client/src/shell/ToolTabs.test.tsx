// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SectionSlot, ToolSlot } from './sections-contract.ts';

const store = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../store.tsx', () => ({
  useStore: () => store.current,
  useToolSnapshot: () => ({ ads: store.current.ads }),
}));
const { ToolTabs } = await import('./ToolTabs.tsx');

const Empty = () => null;
const tool = (id: string, extra: Partial<ToolSlot> = {}): ToolSlot => ({
  id,
  title: `Tool ${id}`,
  icon: 'chart',
  summary: `About ${id}`,
  group: 'Ads',
  Sheet: Empty,
  search: null,
  visible: () => true,
  ...extra,
});
const sec = (tools: ToolSlot[]): SectionSlot => ({
  id: 'workbench',
  title: 'Workbench',
  icon: 'workbench',
  tools,
});
const openTool = vi.fn();
function setup(tools: ToolSlot[], current: ToolSlot) {
  store.current = { ads: null, openTool, view: `tool:workbench/${current.id}` };
  const section = sec(tools);
  return render(<ToolTabs section={section} tool={current} />);
}
afterEach(() => {
  cleanup();
  openTool.mockClear();
});

describe('ToolTabs', () => {
  it('shows one tab per visible tool of the group, in a labelled nav', () => {
    const a = tool('a', { tabLabel: 'Manager' });
    const b = tool('b');
    setup([a, b, tool('c', { group: 'Other' })], a);
    const nav = screen.getByRole('navigation', { name: 'Ads tools' });
    expect(nav.querySelectorAll('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Manager' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tool b' })).toBeTruthy();
  });

  it('shows nothing for a group of one, hidden tools, or no group', () => {
    const a = tool('a');
    const { container } = setup([a, tool('b', { visible: () => false })], a);
    expect(container.firstChild).toBeNull();
    cleanup();
    const n = tool('n', { group: undefined });
    const r = setup([n, tool('m', { group: undefined })], n);
    expect(r.container.firstChild).toBeNull();
  });

  it('marks the current tab and does nothing when it is pressed', () => {
    const a = tool('a');
    const b = tool('b');
    setup([a, b], a);
    const cur = screen.getByRole('button', { name: 'Tool a' });
    expect(cur.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Tool b' }).getAttribute('aria-current')).toBeNull();
    fireEvent.click(cur);
    expect(openTool).not.toHaveBeenCalled();
  });

  it('opens another tool with no argument', () => {
    const a = tool('a');
    const b = tool('b');
    setup([a, b], a);
    fireEvent.click(screen.getByRole('button', { name: 'Tool b' }));
    expect(openTool).toHaveBeenCalledTimes(1);
    expect(openTool.mock.calls[0]).toEqual(['workbench', 'b']);
  });

  it('shows a badge as a count with a spoken name, and a row note as text', () => {
    const a = tool('a', { tabLabel: 'Manager', badge: () => 5 });
    const b = tool('b', { tabLabel: 'Command Centre', rowNote: () => '3 due' });
    const { container } = setup([a, b], a);
    expect(screen.getByRole('button', { name: 'Manager, 5 waiting' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Command Centre, 3 due' })).toBeTruthy();
    expect(container.querySelector('.count')?.textContent).toBe('5');
    expect(container.textContent).toContain('3 due');
  });

  it('shows no count for zero', () => {
    const a = tool('a', { badge: () => 0 });
    const { container } = setup([a, tool('b')], a);
    expect(container.querySelector('.count')).toBeNull();
    expect(screen.getByRole('button', { name: 'Tool a' })).toBeTruthy();
  });
});
