import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clientChoice, clientSlugOf, NO_CLIENT, scopeForClient, todoChatClient } from './client-choice.ts';

beforeEach(() => clientChoice.set(''));

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
