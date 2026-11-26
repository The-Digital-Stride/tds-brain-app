import { describe, expect, it } from 'vitest';
import {
  AUTO,
  type ChatScopeInput,
  chatPlaceWords,
  chatScope,
  NO_PROJECT,
  NONE,
  pickClient,
  pickProject,
  projectChatPlace,
  projectIfClientMatches,
  todoChatProject,
} from './chat-project.ts';

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
  it("a task's project is its matched key when that is a live card", () => {
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

  it("keeps my own live project when a teammate's moved card lists the same key", () => {
    const list = [
      { key: 'north/site', slug: 'site', title: 'North site', client: 'north', movedFrom: ['personal/site'] },
      { key: 'personal/site', slug: 'site', title: 'My site', client: null },
    ];
    const both = [...clients, { slug: 'north', name: 'Northwind' }];
    expect(chatPlaceWords(null, 'personal/site', both, list)).toBe('My site');
  });
});

describe('chatScope', () => {
  const both = [...clients, { slug: 'north' }];
  const base: ChatScopeInput = {
    presetProject: null,
    presetClient: undefined,
    workingOn: '',
    bound: 'chat',
    picks: undefined,
    cards,
    clients: both,
  };
  const scope = (over: Partial<ChatScopeInput>) => chatScope({ ...base, ...over });

  it('app-bound: Home as today (Auto, Working on, no project)', () => {
    const v = scope({ bound: 'app' });
    expect(v).toMatchObject({ bound: 'app', projectLabel: 'Working on', project: '', client: AUTO });
    expect(v.clientSetByProject).toBe(false);
    expect(v.projectFor('acme')).toBeNull();
  });
  it("app-bound: Working on's client starts Chat for, personal is No client, unlisted stays Auto", () => {
    const acme = scope({ bound: 'app', workingOn: 'acme/site' });
    expect(acme).toMatchObject({ project: 'acme/site', client: 'acme', clientSetByProject: true });
    expect(acme.projectFor('acme')).toBe('acme/site');
    expect(acme.projectFor('north')).toBeNull();
    expect(scope({ bound: 'app', workingOn: 'personal/diary' })).toMatchObject({ client: NONE });
    expect(scope({ bound: 'app', workingOn: 'gone/site', clients: [] })).toMatchObject({ client: AUTO });
  });
  it('app-bound: a given client or a hand pick wins and is not "set by project"', () => {
    const given = scope({ bound: 'app', workingOn: 'acme/site', presetClient: null });
    expect(given).toMatchObject({ client: NONE, clientSetByProject: false });
    const hand = scope({ bound: 'app', workingOn: 'acme/site', picks: { project: '', client: 'north' } });
    expect(hand).toMatchObject({ project: 'acme/site', client: 'north', clientSetByProject: false });
    expect(hand.projectFor('north')).toBeNull();
  });

  it('chat-bound: a project fills Project and its own client', () => {
    const v = scope({ presetProject: 'acme/site' });
    expect(v).toMatchObject({ bound: 'chat', projectLabel: 'Project', project: 'acme/site', client: 'acme' });
    expect(v.clientSetByProject).toBe(true);
    expect(v.projectFor('acme')).toBe('acme/site');
  });
  it('chat-bound: Working on is ignored', () => {
    expect(scope({ presetProject: null, workingOn: 'acme/site' })).toMatchObject({
      project: NO_PROJECT,
      client: AUTO,
    });
  });
  it('chat-bound: a personal project is No client and is still sent', () => {
    const v = scope({ presetProject: 'personal/diary', presetClient: null });
    expect(v).toMatchObject({ project: 'personal/diary', client: NONE });
    expect(v.projectFor(null)).toBe('personal/diary');
  });
  it('chat-bound: a client not in the list is No client; the project still shows and goes', () => {
    const orphan = [
      { key: 'zed/site', space: 'client' as const, slug: 'site', client: 'zed', title: 'Z', archived: false },
    ];
    const v = scope({ presetProject: 'zed/site', cards: orphan });
    expect(v).toMatchObject({ project: 'zed/site', client: NONE });
    expect(v.projectFor(null)).toBe('zed/site');
  });
  it('chat-bound: a personal task on a client project starts on its client with No project', () => {
    const v = scope({ presetProject: 'acme/site', presetClient: null });
    expect(v).toMatchObject({ project: NO_PROJECT, client: NONE });
    expect(v.projectFor(null)).toBeNull();
    expect(scope({ presetProject: 'acme/site', presetClient: 'north' })).toMatchObject({
      project: NO_PROJECT,
      client: 'north',
    });
  });
  it("chat-bound: a given client that is the project's own keeps the project", () => {
    expect(scope({ presetProject: 'acme/site', presetClient: 'acme' })).toMatchObject({
      project: 'acme/site',
      client: 'acme',
    });
  });
  it('chat-bound: an archived or unknown key is never shown and never sent', () => {
    for (const key of ['acme/old', 'acme/missing']) {
      const v = scope({ presetProject: key });
      expect(v).toMatchObject({ project: NO_PROJECT, client: AUTO });
      expect(v.projectFor('acme')).toBeNull();
    }
    expect(scope({ presetProject: 'acme/old', presetClient: 'acme' })).toMatchObject({
      project: NO_PROJECT,
      client: 'acme',
    });
    // Not loaded yet: nothing shown, nothing sent.
    expect(scope({ presetProject: 'acme/site', cards: undefined }).project).toBe(NO_PROJECT);
  });
  it('chat-bound: picks replace the preset, and an archived pick is dropped', () => {
    const v = scope({ presetProject: 'acme/site', picks: { project: NO_PROJECT, client: 'north' } });
    expect(v).toMatchObject({ project: NO_PROJECT, client: 'north', clientSetByProject: false });
    expect(v.projectFor('north')).toBeNull();
    expect(scope({ picks: { project: 'acme/old', client: 'acme' } }).project).toBe(NO_PROJECT);
  });
  it('what projectFor returns equals what is shown', () => {
    const states: ChatScopeInput['picks'][] = [
      undefined,
      { project: 'acme/site', client: 'acme' },
      { project: NO_PROJECT, client: 'acme' },
      { project: 'personal/diary', client: NONE },
      { project: NO_PROJECT, client: AUTO },
    ];
    for (const picks of states) {
      for (const presetProject of [null, 'acme/site', 'personal/diary'] as const) {
        const v = scope({ presetProject, picks });
        const final = v.client === NONE ? null : v.client === AUTO ? 'acme' : v.client;
        expect(v.projectFor(final)).toBe(v.project === '' ? null : v.project);
      }
    }
  });
});

describe('pickProject / pickClient', () => {
  const none = { project: NO_PROJECT, client: AUTO };
  it('picking a project sets its own client; personal sets No client', () => {
    expect(pickProject('acme/site', none, cards, clients)).toEqual({ project: 'acme/site', client: 'acme' });
    expect(pickProject('personal/diary', none, cards, clients)).toEqual({
      project: 'personal/diary',
      client: NONE,
    });
  });
  it('No project keeps the client', () => {
    expect(pickProject('', { project: 'acme/site', client: 'acme' }, cards, clients)).toEqual({
      project: NO_PROJECT,
      client: 'acme',
    });
  });
  it('an archived or unknown project is not picked', () => {
    expect(pickProject('acme/old', { project: 'acme/site', client: 'acme' }, cards, clients)).toEqual({
      project: NO_PROJECT,
      client: 'acme',
    });
    expect(pickProject('x/y', none, undefined, clients)).toEqual(none);
  });
  it("picking another client sets No project; the project's own client keeps it", () => {
    const cur = { project: 'acme/site' as const, client: 'acme' };
    expect(pickClient('north', cur, cards, [...clients, { slug: 'north' }])).toEqual({
      project: NO_PROJECT,
      client: 'north',
    });
    expect(pickClient('acme', cur, cards, clients)).toEqual(cur);
    expect(pickClient(NONE, cur, cards, clients)).toEqual({ project: NO_PROJECT, client: NONE });
    expect(pickClient(AUTO, cur, cards, clients)).toEqual({ project: NO_PROJECT, client: AUTO });
  });
  it('No client keeps a personal project', () => {
    const cur = { project: 'personal/diary' as const, client: NONE };
    expect(pickClient(NONE, cur, cards, clients)).toEqual(cur);
  });
});
