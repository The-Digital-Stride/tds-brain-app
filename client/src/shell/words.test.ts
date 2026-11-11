import { describe, expect, it } from 'vitest';
import type { LiveSession, SkillInfo, TodoItem } from '../../../shared/contract.ts';
import {
  chatsRailLabel,
  initials,
  placeName,
  STATE_WORDS,
  starterSkills,
  todoChatDraft,
  todoPlaces,
  whenWords,
} from './words.ts';

const skill = (name: string): SkillInfo => ({
  name,
  title: name,
  description: '',
  kind: 'skill',
  maturity: 'live',
  argumentHint: null,
  restrictedTo: null,
});

const live = (state: LiveSession['state']): LiveSession => ({
  id: state,
  sdkSessionId: null,
  title: '',
  client: null,
  todoId: null,
  state,
  startedAt: '',
  lastActivityAt: '',
});

describe('todoChatDraft', () => {
  it('names the to-do by its path, so the store keeps the chat linked to it', () => {
    const todo: TodoItem = {
      id: '20261111-renew.md',
      title: 'Renew the contract',
      assignee: null,
      due: null,
      surfaceDate: null,
      project: null,
      client: null,
    };
    const draft = todoChatDraft(todo);
    expect(draft).toContain('todo/20261111-renew.md');
    expect(draft).toBe('Help me with this to-do: todo/20261111-renew.md (Renew the contract)');
  });
});

describe('whenWords', () => {
  it('reads a good date as day, month and time', () => {
    const iso = new Date(2026, 10, 11, 16, 42).toISOString();
    expect(whenWords(iso)).toBe('11 Nov, 16:42');
  });

  it('is empty for a date it cannot read', () => {
    expect(whenWords('not a date')).toBe('');
    expect(whenWords('')).toBe('');
  });
});

describe('starterSkills', () => {
  const skills = [skill('meeting-notes'), skill('gm'), skill('time'), skill('standup')];

  it('keeps pin order and drops names it does not know', () => {
    const out = starterSkills({
      skills,
      prefs: { pins: ['gm', 'gone', 'meeting-notes'] },
      usedOften: [],
    });
    expect(out.pinned.map((s) => s.name)).toEqual(['gm', 'meeting-notes']);
  });

  it('lists the used-often skills that are not already pinned', () => {
    const out = starterSkills({
      skills,
      prefs: { pins: ['gm'] },
      usedOften: [{ name: 'time' }, { name: 'gm' }, { name: 'vanished' }, { name: 'standup' }],
    });
    expect(out.often.map((s) => s.name)).toEqual(['time', 'standup']);
  });
});

describe('STATE_WORDS', () => {
  it('says each state in plain words', () => {
    expect(STATE_WORDS.waiting).toBe('Needs your answer');
    expect(STATE_WORDS.working).toBe('Working');
    expect(STATE_WORDS.starting).toBe('Working');
    expect(STATE_WORDS.idle).toBe('Ready for you');
    expect(STATE_WORDS.error).toBe('Stopped by a problem');
    expect(STATE_WORDS.closed).toBe('Ended');
  });
});

describe('chatsRailLabel', () => {
  it('states how many are open and how many need an answer', () => {
    expect(chatsRailLabel([])).toBe('Chats');
    expect(chatsRailLabel([live('idle')])).toBe('Chats, 1 open');
    expect(chatsRailLabel([live('idle'), live('waiting')])).toBe('Chats, 2 open, 1 needs your answer');
    expect(chatsRailLabel([live('waiting'), live('waiting'), live('working')])).toBe(
      'Chats, 3 open, 2 need your answer',
    );
  });
});

describe('initials', () => {
  it('takes the first letter of the first and last names', () => {
    expect(initials('Sam Example')).toBe('SE');
    expect(initials('Ian van Hancock')).toBe('IH');
    expect(initials('cher')).toBe('C');
    expect(initials('  ')).toBe('?');
  });
});

describe('placeName and todoPlaces', () => {
  const clients = [{ slug: 'acme', name: 'Acme Heating' }];
  const todo = (client: string | null, project: string | null) => ({ client, project }) as TodoItem;

  it("uses the client's name, and never shows a folder name as written", () => {
    expect(placeName('acme', clients)).toBe('Acme Heating');
    expect(placeName('gladwell-and-patterson', clients)).toBe('Gladwell and patterson');
    expect(placeName('uc-ai-search', clients)).toBe('UC AI search');
  });
  it('names the client and the project of a to-do', () => {
    expect(todoPlaces(todo('acme', 'website-rebuild'), clients)).toEqual(['Acme Heating', 'Website rebuild']);
    expect(todoPlaces(todo(null, 'acme'), clients)).toEqual(['Acme Heating']);
    expect(todoPlaces(todo(null, null), clients)).toEqual([]);
  });
  it('says a place once when the client and the project are the same', () => {
    expect(todoPlaces(todo('acme', 'acme'), clients)).toEqual(['Acme Heating']);
  });
});
