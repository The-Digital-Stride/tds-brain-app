// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiveHelper, LiveSession } from '../../../shared/contract.ts';

const openChat = vi.hoisted(() => vi.fn());
const dispatch = vi.hoisted(() => vi.fn());
const shell = vi.hoisted(() => ({ modes: { drawerOverlays: false } }));
vi.mock('../store.tsx', () => ({ useStore: () => ({ openChat }) }));
vi.mock('./ShellProvider.tsx', () => ({ useShell: () => ({ dispatch, modes: shell.modes }) }));

const { HelperRows } = await import('./HelperRows.tsx');

const helper = (over: Partial<LiveHelper> = {}): LiveHelper => ({
  id: 'h1',
  name: 'Scout',
  brief: "find Acme's last three reports",
  tier: 'quick',
  model: 'claude-haiku-5-5',
  status: 'working',
  startedAt: new Date(Date.now() - 80_000).toISOString(),
  endedAt: null,
  steps: 2,
  lastStep: 'Reading files',
  ...over,
});
const chat = (helpers?: LiveHelper[]): LiveSession =>
  ({ id: 's1', title: 'Acme', state: 'working', helpers }) as LiveSession;

afterEach(() => {
  cleanup();
  openChat.mockReset();
  dispatch.mockReset();
  shell.modes.drawerOverlays = false;
});

describe('HelperRows', () => {
  it('renders nothing when helpers are absent or empty', () => {
    expect(render(<HelperRows chat={chat()} />).container.innerHTML).toBe('');
    cleanup();
    expect(render(<HelperRows chat={chat([])} />).container.innerHTML).toBe('');
  });

  it('shows name, brief and meta in a Fold with a count', () => {
    const { container } = render(<HelperRows chat={chat([helper()])} />);
    expect(screen.getByText("Scout: find Acme's last three reports")).toBeTruthy();
    expect(screen.getByText(/^Reading files · Quick · Haiku 5\.5 · 1 min \d+ s$/)).toBeTruthy();
    expect(container.querySelector('.fold')).toBeTruthy();
    expect(container.querySelector('svg.icon')).toBeTruthy();
    expect(container.querySelector('details')).toBeNull();
    expect(container.querySelector('.fold-count, .count')?.textContent).toBe('1');
    expect(container.querySelector('.dot')?.getAttribute('data-attention')).toBe('working');
  });

  it('shows just the name when there is no brief', () => {
    render(<HelperRows chat={chat([helper({ brief: '' })])} />);
    expect(screen.getByText('Scout')).toBeTruthy();
  });

  it('is shut with no working dot once every helper has ended', () => {
    const ended = helper({ status: 'failed', endedAt: new Date().toISOString() });
    const { container } = render(<HelperRows chat={chat([ended])} />);
    expect(container.querySelector('.fold')?.getAttribute('data-open')).toBe('false');
    expect(container.querySelector('.dot')?.getAttribute('data-attention')).toBeNull();
    expect(container.querySelector('.line-meta')?.textContent).toMatch(/^Failed · Quick/);
  });

  it('shuts itself when the last helper ends without losing keyboard focus', () => {
    const { rerender } = render(<HelperRows chat={chat([helper()])} />);
    const toggle = screen.getByRole('button', { name: /Helpers/ });
    toggle.focus();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    rerender(<HelperRows chat={chat([helper({ status: 'done', endedAt: new Date().toISOString() })])} />);
    const after = screen.getByRole('button', { name: /Helpers/ });
    expect(after).toBe(toggle);
    expect(document.activeElement).toBe(toggle);
    expect(after.getAttribute('aria-expanded')).toBe('false');
    // A click still opens it again.
    fireEvent.click(after);
    expect(after.getAttribute('aria-expanded')).toBe('true');
  });

  it('opens the chat on click, and closes an overlaying drawer', () => {
    shell.modes.drawerOverlays = true;
    render(<HelperRows chat={chat([helper()])} />);
    fireEvent.click(screen.getByText("Scout: find Acme's last three reports"));
    expect(openChat).toHaveBeenCalledWith('s1');
    expect(dispatch).toHaveBeenCalledWith({ type: 'close-drawer' });
  });
});
