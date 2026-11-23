import { describe, expect, it } from 'vitest';
import { chatPlaceWords, projectChatPlace, projectIfClientMatches, todoChatProject } from './chat-project.ts';

const cards = [
  {
    key: 'acme/site',
    space: 'client' as const,
    slug: 'site',
    client: 'acme',
    title: 'Site',
    archived: false,
  },
  { key: 'acme/old', space: 'client' as const, slug: 'old', client: 'acme', title: 'Old', archived: true },
  {
    key: 'personal/diary',
    space: 'personal' as const,
    slug: 'diary',
    client: null,
    title: 'Diary',
    archived: false,
  },
];
const clients = [{ slug: 'acme', name: 'Acme Heating' }];

describe('chat project helpers', () => {
  it("a to-do's project is its matched key when that is a live card", () => {
    expect(todoChatProject({ projectMatch: { how: 'key', key: 'acme/site' } as never }, cards)).toBe(
      'acme/site',
    );
    expect(todoChatProject({ projectMatch: { how: 'key', key: 'acme/old' } as never }, cards)).toBeNull();
    expect(todoChatProject({ projectMatch: { how: 'none' } }, cards)).toBeNull();
    expect(todoChatProject({}, undefined)).toBeNull();
  });
  it('a project page opens a chat with its key and client; personal has none', () => {
    expect(projectChatPlace(cards[0] as never, clients)).toEqual({ project: 'acme/site', client: 'acme' });
    expect(projectChatPlace(cards[2] as never, clients)).toEqual({ project: 'personal/diary', client: null });
  });
  it('the project goes only while the client still matches', () => {
    expect(projectIfClientMatches('acme/site', cards, clients, 'acme')).toBe('acme/site');
    expect(projectIfClientMatches('acme/site', cards, clients, 'other')).toBeNull();
    expect(projectIfClientMatches('acme/site', cards, clients, null)).toBeNull();
    expect(projectIfClientMatches('personal/diary', cards, clients, null)).toBe('personal/diary');
    expect(projectIfClientMatches('acme/old', cards, clients, 'acme')).toBeNull();
    expect(projectIfClientMatches('acme/site', undefined, clients, 'acme')).toBeNull();
  });
  it('the Chats drawer words', () => {
    expect(chatPlaceWords('acme', 'acme/site', clients, cards)).toBe('Acme Heating · Site');
    expect(chatPlaceWords('acme', null, clients, cards)).toBe('Acme Heating');
    expect(chatPlaceWords(null, 'personal/diary', clients, cards)).toBe('Diary');
    expect(chatPlaceWords(null, null, clients, cards)).toBe('');
    expect(chatPlaceWords('acme', 'acme/gone', clients, cards)).toBe('Acme Heating');
  });

  it('finds a project that moved by its old key, under its client now', () => {
    const moved = [
      { key: 'north/site', slug: 'site', title: 'Site', client: 'north', movedFrom: ['acme/site'] },
    ];
    const both = [...clients, { slug: 'north', name: 'Northwind' }];
    expect(chatPlaceWords('acme', 'acme/site', both, moved)).toBe('Northwind · Site');
  });
});
