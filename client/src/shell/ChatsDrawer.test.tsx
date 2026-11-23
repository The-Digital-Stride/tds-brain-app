// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiveSession, PastSession } from '../../../shared/contract.ts';

const store = vi.hoisted(() => ({
  sessions: null as { live: unknown[]; past: unknown[] } | null,
}));
vi.mock('../store.tsx', () => ({
  useStore: () => ({
    sessions: store.sessions,
    boot: {
      clients: [{ slug: 'acme', name: 'Acme Heating' }],
      prefs: { favouriteChats: [] },
    },
    heldChats: [],
    toggleFavouriteChat: vi.fn(),
    newChat: vi.fn(),
    openChat: vi.fn(),
    openPast: vi.fn(),
    requestClose: vi.fn(),
    holdDeletePastChat: vi.fn(),
    undoDeletePastChat: vi.fn(),
    pauseChatDelete: vi.fn(),
    resumeChatDelete: vi.fn(),
    activeChat: { kind: 'new', key: 1 },
    view: 'home',
  }),
}));
vi.mock('./ShellProvider.tsx', () => ({
  useShell: () => ({ dispatch: vi.fn(), modes: { drawerOverlays: false } }),
}));
vi.mock('../state/projects.ts', () => ({
  useProjects: () => ({
    list: {
      projects: [
        {
          key: 'acme/site',
          title: 'Site rebuild',
          slug: 'site',
          client: 'acme',
          space: 'client',
          archived: false,
        },
        {
          key: 'personal/diary',
          title: 'Diary',
          slug: 'diary',
          client: null,
          space: 'personal',
          archived: false,
        },
      ],
    },
  }),
}));

const { ChatsDrawer } = await import('./ChatsDrawer.tsx');

afterEach(() => cleanup());

describe('ChatsDrawer places', () => {
  it('shows client and project on an open chat', () => {
    store.sessions = {
      live: [
        {
          id: 's1',
          sdkSessionId: null,
          title: 'Quote',
          client: 'acme',
          project: 'acme/site',
          todoId: null,
          state: 'idle',
          startedAt: '',
          lastActivityAt: '',
        } satisfies Partial<LiveSession>,
      ],
      past: [],
    };
    render(<ChatsDrawer />);
    expect(screen.getByText(/ready for you\s*, Acme Heating · Site rebuild/)).toBeTruthy();
  });

  it('shows client and project on an earlier chat, and a personal project alone', () => {
    const past = (id: string, over: Partial<PastSession>) => ({
      sdkSessionId: id,
      title: `Chat ${id}`,
      lastModified: new Date().toISOString(),
      ...over,
    });
    store.sessions = {
      live: [],
      past: [
        past('a', { client: 'acme', project: 'acme/site' }),
        past('b', { client: null, project: 'personal/diary' }),
      ],
    };
    render(<ChatsDrawer />);
    fireEvent.click(screen.getByRole('radio', { name: 'Earlier' }));
    const metas = Array.from(document.querySelectorAll('.line-meta')).map((m) => m.textContent ?? '');
    expect(metas.some((t) => t.endsWith(', Acme Heating · Site rebuild'))).toBe(true);
    expect(metas.some((t) => t.endsWith(', Diary'))).toBe(true);
  });
});
