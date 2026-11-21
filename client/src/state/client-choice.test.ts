// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectList } from '../../../shared/projects-contract.ts';
import {
  clientChoice,
  clientForProject,
  clientSlugOf,
  NO_CLIENT,
  projectChoice,
  scopeForClient,
  setChoice,
  todoChatClient,
  useProjectChoice,
} from './client-choice.ts';
import { projectsStore } from './projects.ts';

beforeEach(() => {
  setChoice({ client: '', project: '' });
  projectsStore.reset();
});

describe('clientChoice', () => {
  it('starts with nothing chosen, keeps what is chosen and tells whoever is listening', () => {
    expect(clientChoice.get()).toBe('');
    const heard = vi.fn();
    const stop = clientChoice.subscribe(heard);
    clientChoice.set('client:acme');
    expect(clientChoice.get()).toBe('client:acme');
    expect(heard).toHaveBeenCalledTimes(1);
    // Choosing the same again is not news.
    clientChoice.set('client:acme');
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    clientChoice.set('personal');
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe('clientSlugOf and scopeForClient', () => {
  it("reads a client's folder name out of the choice", () => {
    expect(clientSlugOf('client:acme')).toBe('acme');
  });
  it('reads "no client" for the person\'s own files and for an outright "No client"', () => {
    expect(clientSlugOf('personal')).toBe('');
    expect(clientSlugOf(NO_CLIENT)).toBe('');
  });
  it('says nothing was chosen when nothing was', () => {
    expect(clientSlugOf('')).toBeNull();
  });
  it('turns a client picked on Home into the choice', () => {
    expect(scopeForClient('acme')).toBe('client:acme');
    expect(scopeForClient('')).toBe(NO_CLIENT);
  });
});

describe('todoChatClient', () => {
  const clients = [{ slug: 'acme' }];
  it('keeps a listed client, gives a personal to-do none, and leaves the rest to be worked out', () => {
    expect(todoChatClient({ key: 'a.md', client: 'acme' }, clients)).toBe('acme');
    expect(todoChatClient({ key: 'personal/a.md', client: 'acme' }, clients)).toBeNull();
    // A client folder that has gone, or no client at all: worked out from the message.
    expect(todoChatClient({ key: 'a.md', client: 'gone' }, clients)).toBeUndefined();
    expect(todoChatClient({ key: 'a.md', client: null }, clients)).toBeUndefined();
  });
});

describe('the client and project choice', () => {
  it('a project always sets its client with it', () => {
    projectChoice.set('acme/website');
    expect(projectChoice.get()).toEqual({ client: 'client:acme', project: 'acme/website' });
    projectChoice.set('personal/diary');
    expect(projectChoice.get()).toEqual({ client: 'personal', project: 'personal/diary' });
    expect(clientForProject('northwind/seo')).toBe('client:northwind');
  });

  it('a different client clears the project; the same client keeps it', () => {
    projectChoice.set('acme/website');
    clientChoice.set('client:acme');
    expect(projectChoice.get().project).toBe('acme/website');
    clientChoice.set('client:northwind');
    expect(projectChoice.get()).toEqual({ client: 'client:northwind', project: '' });
  });

  it('clearing the project keeps the client', () => {
    projectChoice.set('acme/website');
    projectChoice.set('');
    expect(projectChoice.get()).toEqual({ client: 'client:acme', project: '' });
  });

  it("setChoice is atomic: one notification, and a project that is not the client's is dropped", () => {
    const heard = vi.fn();
    const stop = clientChoice.subscribe(heard);
    setChoice({ client: 'client:acme', project: 'acme/website' });
    expect(heard).toHaveBeenCalledTimes(1);
    setChoice({ client: 'client:northwind', project: 'acme/website' });
    expect(projectChoice.get()).toEqual({ client: 'client:northwind', project: '' });
    stop();
  });

  it('is one snapshot: readers never see a new client with the old project', () => {
    projectChoice.set('acme/website');
    const seen: string[] = [];
    const stop = clientChoice.subscribe(() =>
      seen.push(`${projectChoice.get().client}|${projectChoice.get().project}`),
    );
    clientChoice.set('client:northwind');
    stop();
    expect(seen).toEqual(['client:northwind|']);
  });
});

describe('useProjectChoice', () => {
  const listOf = (...keys: string[]) =>
    ({
      projects: keys.map((key) => ({ key })),
      canChange: true,
      looseLabels: 0,
      duplicates: [],
      skippedFolders: 0,
    }) as unknown as ProjectList;

  it('keeps a project that is in the list and clears one that is not', () => {
    projectChoice.set('acme/website');
    projectsStore.apply(listOf('acme/website'));
    const { result } = renderHook(() => useProjectChoice());
    expect(result.current).toBe('acme/website');
    act(() => projectsStore.apply(listOf('northwind/seo')));
    expect(result.current).toBe('');
    expect(projectChoice.get().client).toBe('client:acme');
  });
});
