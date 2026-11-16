// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdsSummary } from '../../../shared/ads-contract.ts';
import type { SectionSlot, ToolSlot } from './sections-contract.ts';

const store = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const shell = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: { drawer: 'section', section: 'workbench', singleKeys: true },
}));
vi.mock('../store.tsx', () => ({ useStore: () => store.current }));
vi.mock('./ShellProvider.tsx', () => ({
  useShell: () => ({ state: shell.state, dispatch: shell.dispatch }),
  useDesk: () => ({ railShowsNames: false, width: 1400 }),
}));
vi.mock('./SyncStamp.tsx', () => ({ SyncStamp: () => null }));
const { SectionDrawer } = await import('./SectionDrawer.tsx');
const { Rail } = await import('./Rail.tsx');
const { SECTIONS } = await import('./sections.ts');

const ads = (waiting = 0): AdsSummary =>
  ({ visible: true, me: null, sameIdentity: true, waiting, clients: [] }) as unknown as AdsSummary;
const Empty = () => null;
const tool = (id: string, extra: Partial<ToolSlot> = {}): ToolSlot => ({
  id,
  title: `Tool ${id}`,
  icon: 'chart',
  summary: `About ${id}`,
  Sheet: Empty,
  search: null,
  visible: () => true,
  ...extra,
});
const section = (tools: ToolSlot[]): SectionSlot => ({
  id: 'workbench',
  title: 'Workbench',
  icon: 'workbench',
  key: 'w',
  railName: (n) => `Workbench, ${n} waiting`,
  tools,
});
const openTool = vi.fn();
function setup(tools: ToolSlot[], view = 'chat', adsValue: AdsSummary | null = ads()) {
  // The real Workbench section, with the tools this test wants in it.
  Object.assign(SECTIONS[0] as SectionSlot, section(tools));
  store.current = {
    boot: { identity: { slug: 'sam', name: 'Sam', role: 'owner' }, prefs: {} },
    todos: { mine: [] },
    sessions: { live: [] },
    view,
    activeChat: { kind: 'new' },
    newChat: vi.fn(),
    openView: vi.fn(),
    openTool,
    ads: adsValue,
  };
}
beforeEach(() => {
  shell.dispatch.mockClear();
  openTool.mockClear();
});
afterEach(cleanup);

describe('SectionDrawer', () => {
  it('shows an icon, title, summary and a count above 0', () => {
    setup([tool('a', { badge: () => 3 }), tool('b')]);
    const { container } = render(<SectionDrawer />);
    const a = screen.getByRole('button', { name: /Tool a/ });
    expect(within(a).getByText('About a')).toBeTruthy();
    expect(within(a).getByText('3')).toBeTruthy();
    expect(a.querySelector('svg.icon')).toBeTruthy();
    expect(within(screen.getByRole('button', { name: /Tool b/ })).queryByText('0')).toBeNull();
    expect(container.querySelector('.drawer-tools')).toBeNull();
  });

  it('marks the open tool as the current page', () => {
    setup([tool('a'), tool('b')], 'tool:workbench/b');
    render(<SectionDrawer />);
    expect(screen.getByRole('button', { name: /Tool b/ }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: /Tool a/ }).getAttribute('aria-current')).toBeNull();
  });

  it('choosing a tool opens it; on the same tool it also closes the drawer', () => {
    setup([tool('a'), tool('b')], 'tool:workbench/b');
    render(<SectionDrawer />);
    fireEvent.click(screen.getByRole('button', { name: /Tool a/ }));
    expect(openTool).toHaveBeenCalledWith('workbench', 'a');
    expect(shell.dispatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Tool b/ }));
    expect(shell.dispatch).toHaveBeenCalledWith({ type: 'close-drawer' });
  });

  it('leaves out tools that are not visible', () => {
    setup([tool('a'), tool('b', { visible: () => false })]);
    render(<SectionDrawer />);
    expect(screen.queryByRole('button', { name: /Tool b/ })).toBeNull();
  });

  it('uses folds only with two or more groups', () => {
    setup([tool('a', { group: 'One' }), tool('b', { group: 'One' })]);
    const one = render(<SectionDrawer />);
    expect(one.container.querySelector('.fold')).toBeNull();
    cleanup();
    setup([tool('a', { group: 'One' }), tool('b', { group: 'Two' })]);
    const two = render(<SectionDrawer />);
    expect(two.container.querySelectorAll('.fold')).toHaveLength(2);
  });

  it('has a search row only above 8 tools', () => {
    setup(Array.from({ length: 8 }, (_, i) => tool(`t${i}`)));
    const eight = render(<SectionDrawer />);
    expect(eight.container.querySelector('.drawer-tools')).toBeNull();
    cleanup();
    setup(Array.from({ length: 9 }, (_, i) => tool(`t${i}`)));
    const nine = render(<SectionDrawer />);
    expect(nine.container.querySelector('.drawer-tools')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 't3' } });
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});

describe('the rail item for a section', () => {
  it('is absent while no tool is visible, and present once one is', () => {
    setup([tool('a', { visible: (s) => s.ads?.visible === true })], 'chat', null);
    render(<Rail />);
    expect(screen.queryByRole('button', { name: /Workbench/ })).toBeNull();
    cleanup();
    setup([tool('a', { visible: (s) => s.ads?.visible === true })], 'chat', ads());
    render(<Rail />);
    expect(screen.getByRole('button', { name: 'Workbench' })).toBeTruthy();
  });

  it('says how many are waiting, summed over its tools, and toggles the section', () => {
    setup([tool('a', { badge: () => 2 }), tool('b', { badge: () => 3 })]);
    render(<Rail />);
    const item = screen.getByRole('button', { name: 'Workbench, 5 waiting' });
    expect(item.getAttribute('aria-keyshortcuts')).toBe('w');
    fireEvent.click(item);
    expect(shell.dispatch).toHaveBeenCalledWith({ type: 'toggle-section', section: 'workbench' });
  });
});
