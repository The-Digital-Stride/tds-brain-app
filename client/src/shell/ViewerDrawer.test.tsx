// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHELL_STORAGE_KEY } from './contract.ts';

vi.mock('../store.tsx', () => ({
  useStore: () => ({ view: 'chat', activeChat: { kind: 'none' } }),
}));

const { ShellProvider } = await import('./ShellProvider.tsx');
const { ViewerDrawer } = await import('./ViewerDrawer.tsx');

const setWindow = (w: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
};
const saved = () => JSON.parse(localStorage.getItem(SHELL_STORAGE_KEY) ?? '{}');
const mount = () =>
  render(
    <ShellProvider>
      <ViewerDrawer role="dialog" aria-label="Viewer">
        <iframe title="page" />
      </ViewerDrawer>
    </ShellProvider>,
  );
const handle = () => screen.getByRole('separator', { name: 'Resize viewer' });
const drawer = () => screen.getByRole('dialog');

beforeEach(() => {
  localStorage.clear();
  setWindow(1600);
});
afterEach(cleanup);

describe('ViewerDrawer resize handle', () => {
  it('is a vertical separator with px values: narrowest 1040, widest the window less the rail', () => {
    mount();
    const h = handle();
    expect(h.getAttribute('aria-orientation')).toBe('vertical');
    expect(h.getAttribute('tabindex')).toBe('0');
    expect(h.getAttribute('aria-valuemin')).toBe('1040');
    expect(h.getAttribute('aria-valuemax')).toBe(String(1600 - 24 - 70));
    expect(h.getAttribute('aria-valuenow')).toBe('1040');
    expect(h.getAttribute('data-tip')).toBe('Drag to resize. Double-click to reset.');
  });

  it('Left widens by 32px (Shift 128px), Right narrows, Home and End go to the ends', () => {
    mount();
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' });
    expect(handle().getAttribute('aria-valuenow')).toBe('1072');
    expect(drawer().style.width).toBe('1072px');
    fireEvent.keyDown(handle(), { key: 'ArrowLeft', shiftKey: true });
    expect(handle().getAttribute('aria-valuenow')).toBe('1200');
    fireEvent.keyDown(handle(), { key: 'ArrowRight' });
    expect(handle().getAttribute('aria-valuenow')).toBe('1168');
    fireEvent.keyDown(handle(), { key: 'End' });
    expect(handle().getAttribute('aria-valuenow')).toBe('1506');
    fireEvent.keyDown(handle(), { key: 'Home' });
    expect(handle().getAttribute('aria-valuenow')).toBe('1040');
  });

  it('saves the width in the shell state and restores it', () => {
    const first = mount();
    fireEvent.keyDown(handle(), { key: 'ArrowLeft', shiftKey: true });
    expect(saved().viewerWidth).toBe(1168);
    first.unmount();
    mount();
    expect(drawer().style.width).toBe('1168px');
  });

  it('double-click goes back to the default width and forgets the saved one', () => {
    mount();
    fireEvent.keyDown(handle(), { key: 'ArrowLeft', shiftKey: true });
    fireEvent.doubleClick(handle());
    expect(handle().getAttribute('aria-valuenow')).toBe('1040');
    expect(drawer().style.width).toBe('');
    expect(saved().viewerWidth).toBeUndefined();
  });

  it('dragging left widens; the page frame is shielded while it lasts', () => {
    mount();
    const h = handle();
    fireEvent.pointerDown(h, { clientX: 500, pointerId: 1, button: 0 });
    expect(document.body.classList.contains('viewer-resizing')).toBe(true);
    fireEvent.pointerMove(h, { clientX: 400, pointerId: 1 });
    expect(drawer().style.width).toBe('1140px');
    fireEvent.pointerUp(h, { clientX: 400, pointerId: 1 });
    expect(document.body.classList.contains('viewer-resizing')).toBe(false);
    expect(saved().viewerWidth).toBe(1140);
  });

  it('clamps a saved width when the window shrinks, without losing it', () => {
    localStorage.setItem(SHELL_STORAGE_KEY, JSON.stringify({ viewerWidth: 1400 }));
    mount();
    expect(handle().getAttribute('aria-valuenow')).toBe('1400');
    act(() => {
      setWindow(1300);
      window.dispatchEvent(new Event('resize'));
    });
    expect(handle().getAttribute('aria-valuenow')).toBe(String(1300 - 24 - 70));
    expect(saved().viewerWidth).toBe(1400);
  });

  it('has no handle where the drawer is full width (narrow screens) or has no room to grow', () => {
    setWindow(600);
    mount();
    expect(screen.queryByRole('separator')).toBeNull();
    expect(drawer().style.width).toBe('');
  });
});
