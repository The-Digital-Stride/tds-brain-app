// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShellApi } from './contract.ts';

const store = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../store.tsx', () => ({
  useStore: () => store.current,
  useToolSnapshot: () => ({ ads: store.current.ads ?? null }),
}));

const { ShellProvider, useShell } = await import('./ShellProvider.tsx');
const { initialChatState } = await import('../state/chat-reducer.ts');

let api: ShellApi;
function Probe() {
  api = useShell();
  return null;
}
const setStore = (over: Record<string, unknown> = {}) => {
  store.current = {
    boot: { identity: { role: 'owner' } },
    view: 'chat',
    activeChat: { kind: 'new' },
    chats: {},
    ...over,
  };
};
const mount = () =>
  render(
    <ShellProvider>
      <Probe />
    </ShellProvider>,
  );
const press = (key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document.body, { key, ...init });

beforeEach(() => {
  window.localStorage.clear();
  setStore();
});
afterEach(cleanup);

describe('ShellProvider: opening Help', () => {
  it('opens on the page for Home when nothing is open, with H', () => {
    mount();
    press('h');
    expect(api.state).toMatchObject({ drawer: 'help', helpPage: 'home', helpReturn: null });
  });

  it('? opens it too, and opens on the drawer it replaced', () => {
    mount();
    act(() => api.dispatch({ type: 'open-drawer', drawer: 'todos' }));
    press('?', { shiftKey: true });
    expect(api.state).toMatchObject({ drawer: 'help', helpPage: 'todos', helpReturn: 'todos' });
    press('Escape');
    expect(api.state).toMatchObject({ drawer: 'todos', helpReturn: null });
  });

  it('follows the chat: talking, and waiting on an answer', () => {
    setStore({ activeChat: { kind: 'live', sessionId: 's1' }, chats: { s1: initialChatState } });
    mount();
    press('h');
    expect(api.state.helpPage).toBe('talking-to-claude');
    press('h');
    expect(api.state.drawer).toBeNull();
    const waiting = {
      ...initialChatState,
      items: [{ kind: 'question', outcome: null }],
    };
    setStore({ activeChat: { kind: 'live', sessionId: 's1' }, chats: { s1: waiting } });
    // The provider reads the latest store on each render.
    act(() => api.dispatch({ type: 'set-single-keys', on: true }));
    press('h');
    expect(api.state.helpPage).toBe('approvals-and-questions');
  });

  it('a page asked for by a HelpLink wins', () => {
    mount();
    act(() => api.dispatch({ type: 'open-help', page: 'skills' }));
    expect(api.state).toMatchObject({ drawer: 'help', helpPage: 'skills' });
  });

  it.each(['team', 'scout', 'unknown'])('opens for %s too', (role) => {
    setStore({ boot: { identity: { role } } });
    mount();
    press('h');
    expect(api.state).toMatchObject({ drawer: 'help', helpPage: 'home' });
    press('h');
    expect(api.state.drawer).toBeNull();
    press('?', { shiftKey: true });
    expect(api.state.drawer).toBe('help');
    act(() => api.dispatch({ type: 'toggle-drawer', drawer: 'help' }));
    expect(api.state.drawer).toBeNull();
    act(() => api.dispatch({ type: 'open-help', page: 'home' }));
    expect(api.state).toMatchObject({ drawer: 'help', helpPage: 'home' });
  });
});

describe('ShellProvider: Customise Home', () => {
  it('closes when the sheet leaves Home, and cannot open off Home', () => {
    const { rerender } = mount();
    act(() => api.dispatch({ type: 'set-customise-home', open: true }));
    expect(api.state.homeCustomiseOpen).toBe(true);
    setStore({ view: 'settings' });
    rerender(
      <ShellProvider>
        <Probe />
      </ShellProvider>,
    );
    expect(api.onHome).toBe(false);
    expect(api.state.homeCustomiseOpen).toBe(false);
  });
});
