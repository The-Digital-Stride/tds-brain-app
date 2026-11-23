// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShellApi } from './contract.ts';

const store = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../store.tsx', () => ({
  useStore: () => store.current,
  useToolSnapshot: () => ({ ads: null, adsDue: null }),
}));

const { ShellProvider, useShell } = await import('./ShellProvider.tsx');

let api: ShellApi;
function Probe() {
  api = useShell();
  return null;
}
const mount = () =>
  render(
    <ShellProvider>
      <Probe />
    </ShellProvider>,
  );
const openPanel = () => act(() => api.dispatch({ type: 'set-panel', open: true }));
const dirty = (on: boolean) => act(() => api.dispatch({ type: 'set-panel-dirty', dirty: on }));

beforeEach(() => {
  window.localStorage.clear();
  store.current = {
    boot: { identity: { role: 'owner' } },
    view: 'chat',
    activeChat: { kind: 'new' },
    chats: {},
  };
});
afterEach(cleanup);

describe('ShellProvider: the right panel holds unsaved work', () => {
  it('closes at once when nothing is unsaved', () => {
    mount();
    openPanel();
    act(() => api.dispatch({ type: 'set-panel', open: false }));
    expect(api.state.panelOpen).toBe(false);
    expect(api.panelHold).toEqual({ dirty: false, asking: false });
  });

  it('holds a close, a toggle and a guarded step while the panel is dirty, and asks', () => {
    mount();
    openPanel();
    dirty(true);
    expect(api.panelHold).toEqual({ dirty: true, asking: false });
    act(() => api.dispatch({ type: 'set-panel', open: false }));
    expect(api.state.panelOpen).toBe(true);
    expect(api.panelHold.asking).toBe(true);
    act(() => api.dispatch({ type: 'keep-panel' }));
    expect(api.panelHold).toEqual({ dirty: true, asking: false });
    act(() => api.dispatch({ type: 'toggle-panel' }));
    expect(api.state.panelOpen).toBe(true);
    expect(api.panelHold.asking).toBe(true);
  });

  it('Keep drops the held action and runs nothing', () => {
    mount();
    openPanel();
    dirty(true);
    const run = vi.fn();
    act(() => api.guardPanel(run));
    expect(run).not.toHaveBeenCalled();
    expect(api.panelHold.asking).toBe(true);
    act(() => api.dispatch({ type: 'keep-panel' }));
    expect(run).not.toHaveBeenCalled();
    expect(api.panelHold).toEqual({ dirty: true, asking: false });
    // Discard with nothing held changes nothing but the flag.
    act(() => api.dispatch({ type: 'discard-panel' }));
    expect(run).not.toHaveBeenCalled();
  });

  it('Discard clears the hold and runs the held close', () => {
    mount();
    openPanel();
    dirty(true);
    act(() => api.dispatch({ type: 'set-panel', open: false }));
    act(() => api.dispatch({ type: 'discard-panel' }));
    expect(api.state.panelOpen).toBe(false);
    expect(api.panelHold).toEqual({ dirty: false, asking: false });
  });

  it('Discard runs a guarded step once; a clean panel runs it with no question', () => {
    mount();
    openPanel();
    const run = vi.fn();
    act(() => api.guardPanel(run));
    expect(run).toHaveBeenCalledTimes(1);
    expect(api.panelHold.asking).toBe(false);
    dirty(true);
    act(() => api.guardPanel(run));
    expect(run).toHaveBeenCalledTimes(1);
    act(() => api.dispatch({ type: 'discard-panel' }));
    expect(run).toHaveBeenCalledTimes(2);
    expect(api.panelHold).toEqual({ dirty: false, asking: false });
  });

  it('does not hold actions that leave the panel open, and saving (clean) ends the question', () => {
    mount();
    openPanel();
    dirty(true);
    act(() => api.dispatch({ type: 'set-single-keys', on: false }));
    expect(api.panelHold.asking).toBe(false);
    act(() => api.dispatch({ type: 'set-panel', open: false }));
    expect(api.panelHold.asking).toBe(true);
    dirty(false);
    expect(api.panelHold).toEqual({ dirty: false, asking: false });
    act(() => api.dispatch({ type: 'set-panel', open: false }));
    expect(api.state.panelOpen).toBe(false);
  });

  it('leaves the to-do hold alone: a dirty to-do panel still asks through its own action', () => {
    mount();
    act(() => api.dispatch({ type: 'open-drawer', drawer: 'todos' }));
    act(() => api.dispatch({ type: 'open-todo', key: 'a', mode: 'edit' }));
    act(() => api.dispatch({ type: 'set-todo-dirty', dirty: true }));
    act(() => api.dispatch({ type: 'close-todo' }));
    expect(api.state.todoPanel?.ask).toEqual({ type: 'close-todo' });
    expect(api.panelHold).toEqual({ dirty: false, asking: false });
  });
});
