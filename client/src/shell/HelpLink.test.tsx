// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const dispatch = vi.hoisted(() => vi.fn());
vi.mock('../store.tsx', () => ({ useStore: () => store.current }));
vi.mock('./ShellProvider.tsx', () => ({ useShell: () => ({ state: {}, dispatch }) }));
vi.mock('../help/library.ts', () => ({
  helpLibrary: { byId: (id: string) => (id === 'todos' ? { id: 'todos', title: 'Tasks' } : undefined) },
}));

const { HelpLink } = await import('./HelpLink.tsx');
afterEach(() => {
  cleanup();
  dispatch.mockClear();
});
const as = (role: string) => {
  store.current = { boot: { identity: { role } } };
};

describe('HelpLink', () => {
  it('is an icon button named for its page, and opens Help on it, for an owner', () => {
    as('owner');
    render(<HelpLink page="todos" />);
    const button = screen.getByRole('button', { name: 'Help: Tasks' });
    expect(button.classList.contains('icon-btn')).toBe(true);
    expect(button.getAttribute('data-tip')).toBe('Help');
    fireEvent.click(button);
    expect(dispatch).toHaveBeenCalledWith({ type: 'open-help', page: 'todos' });
  });

  it('is 32px by default and 28px in a row', () => {
    as('owner');
    const { rerender } = render(<HelpLink page="todos" />);
    expect(screen.getByRole('button').getAttribute('data-size')).toBeNull();
    rerender(<HelpLink page="todos" size={28} />);
    expect(screen.getByRole('button').getAttribute('data-size')).toBe('small');
  });

  it.each(['team', 'scout', 'unknown'])('is shown for %s', (role) => {
    as(role);
    render(<HelpLink page="todos" />);
    expect(screen.getByRole('button', { name: 'Help: Tasks' })).toBeTruthy();
  });

  it('is not shown for a page that does not exist', () => {
    as('owner');
    render(<HelpLink page="nope" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
