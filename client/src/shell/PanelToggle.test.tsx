// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  state: { homeCustomiseOpen: false, panelOpen: false },
  onHome: true,
  dispatch: vi.fn(),
}));

vi.mock('./ShellProvider.tsx', () => ({
  useShell: () => ({ state: h.state, dispatch: h.dispatch, onHome: h.onHome }),
}));

const { PanelToggle } = await import('./PanelToggle.tsx');

beforeEach(() => {
  h.state = { homeCustomiseOpen: false, panelOpen: false };
  h.onHome = true;
  h.dispatch.mockClear();
});
afterEach(cleanup);

describe('PanelToggle', () => {
  it('on Home opens and closes Customise Home, and aria-pressed follows it', () => {
    const { rerender } = render(<PanelToggle label="Customise Home" />);
    const btn = screen.getByRole('button', { name: 'Customise Home' });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    expect(h.dispatch).toHaveBeenLastCalledWith({ type: 'set-customise-home', open: true });
    h.state = { homeCustomiseOpen: true, panelOpen: false };
    rerender(<PanelToggle label="Customise Home" />);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(btn);
    expect(h.dispatch).toHaveBeenLastCalledWith({ type: 'set-customise-home', open: false });
  });

  it('off Home toggles the chat panel and ignores homeCustomiseOpen', () => {
    h.onHome = false;
    h.state = { homeCustomiseOpen: true, panelOpen: false };
    render(<PanelToggle label="This chat" />);
    const btn = screen.getByRole('button', { name: 'This chat' });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.dispatch).toHaveBeenCalledWith({ type: 'toggle-panel' });
  });
});
