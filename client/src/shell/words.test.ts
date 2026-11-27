import { describe, expect, it } from 'vitest';
import type { AskedTodo, LiveSession, SkillInfo, TodoItem } from '../../../shared/contract.ts';
import {
  askedMeta,
  askedStatusLine,
  changeLine,
  chatsRailLabel,
  handoverLine,
  handoverMeta,
  initials,
  placeName,
  STATE_WORDS,
  starterSkills,
  syncWords,
  todoChatDraft,
  todoPlaces,
  todosRailLabel,
  updateWhen,
  updateWhenFull,
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
  kind: 'tds',
});

describe('todoChatDraft', () => {
  it('names the task by its path, so the store keeps the chat linked to it', () => {
    const todo: TodoItem = {
      id: '20261111-renew.md',
      scope: 'tds',
      key: '20261111-renew.md',
      path: 'todo/20261111-renew.md',
      handover: null,
      createdBy: null,
      title: 'Renew the contract',
      created: null,
      source: null,
      details: '',
      version: 'v1',
      attachments: [],
      assignee: null,
      due: null,
      surfaceDate: null,
      project: null,
      client: null,
    };
    const draft = todoChatDraft(todo);
    expect(draft).toContain('todo/20261111-renew.md');
    expect(todoChatDraft({ ...todo, path: 'personal/todo/20261111-renew.md' })).toContain(
      'personal/todo/20261111-renew.md',
    );
    expect(draft).toBe('Help me with this task: todo/20261111-renew.md (Renew the contract)');
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
  it('names the client and the project of a task', () => {
    expect(todoPlaces(todo('acme', 'website-rebuild'), clients)).toEqual(['Acme Heating', 'Website rebuild']);
    expect(todoPlaces(todo(null, 'acme'), clients)).toEqual(['Acme Heating']);
    expect(todoPlaces(todo(null, null), clients)).toEqual([]);
  });
  it('says a place once when the client and the project are the same', () => {
    expect(todoPlaces(todo('acme', 'acme'), clients)).toEqual(['Acme Heating']);
  });
});

describe('syncWords', () => {
  const at = new Date(2026, 10, 12, 11, 24, 44);
  const iso = at.toISOString();
  const later = (ms: number) => at.getTime() + ms;

  it('shows the local time and date, not stale within five minutes', () => {
    const w = syncWords(iso, later(4 * 60_000));
    expect(w).toMatchObject({
      stale: false,
      time: '11:24',
      date: '12 Nov',
      lead: 'Synced',
      line: 'Synced 11:24, 12 Nov',
    });
    expect(w.spoken).toBe('The brain last synced at 11:24 on 12 Nov.');
  });

  it('is still fresh at exactly five minutes, and stale just after', () => {
    expect(syncWords(iso, later(5 * 60_000)).stale).toBe(false);
    const w = syncWords(iso, later(5 * 60_000 + 1));
    expect(w.stale).toBe(true);
    expect(w.lead).toBe('Not synced since');
    expect(w.line).toBe('Not synced since 11:24, 12 Nov');
    expect(w.spoken).toBe(
      `The brain has not synced since 11:24 on 12 Nov, 5 minutes ago. It normally syncs every minute, so check you're online and Brain Connect is running.`,
    );
  });

  it('counts longer gaps in hours and days', () => {
    expect(syncWords(iso, later(60 * 60_000)).spoken).toContain(', 1 hour ago.');
    expect(syncWords(iso, later(3 * 60 * 60_000)).spoken).toContain(', 3 hours ago.');
    expect(syncWords(iso, later(50 * 60 * 60_000)).spoken).toContain(', 2 days ago.');
  });

  it('is not stale when the sync time is ahead of the clock', () => {
    expect(syncWords(iso, later(-60_000)).stale).toBe(false);
  });

  it('is stale with nothing to show when it never synced or the time cannot be read', () => {
    for (const bad of [null, '', 'not a date']) {
      expect(syncWords(bad, at.getTime())).toEqual({
        stale: true,
        time: '',
        date: '',
        lead: 'No sync found',
        line: 'No sync found',
        spoken: "The app has not seen the brain sync yet. Check you're online and Brain Connect is running.",
      });
    }
  });
});

describe('handover words', () => {
  const now = new Date(2026, 10, 13, 12, 0);
  const h = (
    over: Partial<NonNullable<TodoItem['handover']>> = {},
    assignee: string | null = 'sam-example',
  ) => ({
    assignee,
    handover: {
      by: 'ben-mcadam',
      byName: 'Ben McAdam',
      at: new Date(2026, 10, 12, 9, 0).toISOString(),
      from: null,
      via: 'TDS Brain App',
      source: 'stamp' as const,
      ...over,
    },
  });
  it('says who and when in the row, or git history', () => {
    expect(handoverMeta(h(), 'sam-example', now)).toBe('from Ben, yesterday');
    expect(handoverMeta(h({ source: 'history' }), 'sam-example', now)).toBe('from Ben (git history)');
    expect(handoverMeta(h({ at: new Date(2026, 10, 10).toISOString() }), 'sam-example', now)).toBe(
      'from Ben, 3 days ago',
    );
  });
  it('falls back to the slug, then to "someone", when the name is not known', () => {
    expect(handoverMeta(h({ byName: null }), 'sam-example', now)).toBe('from Ben, yesterday');
    expect(handoverMeta(h({ byName: null, by: null }), 'sam-example', now)).toBe('from someone, yesterday');
    expect(handoverLine(h({ byName: null, by: null }), 'sam-example')).toBe(
      'Passed to you by someone, 12 Nov (TDS Cortex)',
    );
  });
  it('says nothing for your own, old or missing handovers', () => {
    expect(handoverMeta(h({ by: 'sam-example' }), 'sam-example', now)).toBeNull();
    expect(handoverMeta(h({ at: new Date(2026, 9, 1).toISOString() }), 'sam-example', now)).toBeNull();
    expect(handoverMeta({ handover: null, assignee: 'sam-example' }, 'sam-example', now)).toBeNull();
  });
  it('says nothing for a task that is open or belongs to someone else', () => {
    expect(handoverMeta(h({}, null), 'sam-example', now)).toBeNull();
    expect(handoverLine(h({}, null), 'sam-example')).toBeNull();
    expect(handoverMeta(h({}, 'ben-mcadam'), 'sam-example', now)).toBeNull();
  });
  it('shows tasks stamped with the old app name under the new one, and other stamps as they are', () => {
    expect(handoverLine(h({ via: 'TDS Brain App' }), 'sam-example')).toBe(
      'Passed to you by Ben McAdam, 12 Nov (TDS Cortex)',
    );
    expect(handoverLine(h({ via: 'TDS Cortex' }), 'sam-example')).toBe(
      'Passed to you by Ben McAdam, 12 Nov (TDS Cortex)',
    );
    expect(handoverLine(h({ via: 'Workbench' }), 'sam-example')).toBe(
      'Passed to you by Ben McAdam, 12 Nov (Workbench)',
    );
  });
  it('words the editor line', () => {
    expect(handoverLine(h(), 'sam-example')).toBe('Passed to you by Ben McAdam, 12 Nov (TDS Cortex)');
    expect(handoverLine(h({ source: 'history', via: null }), 'sam-example')).toBe(
      'From Ben McAdam (git history), 12 Nov',
    );
  });
});

describe('updateWhen', () => {
  const now = new Date('2026-11-27T21:50:00Z');
  it('reads like the rest of the app: Today, Yesterday, a day, and the year only when it is not this year', () => {
    expect(updateWhen('2026-11-27T14:05:00+00:00', now)).toBe('Today, 14:05');
    expect(updateWhen('2026-11-26T09:05:00+00:00', now)).toBe('Yesterday, 09:05');
    expect(updateWhen('2026-11-03T14:20:00+00:00', now)).toBe('3 Nov, 14:20');
    expect(updateWhen('2025-12-30T08:00:00+00:00', now)).toBe('30 Dec 2025, 08:00');
    expect(updateWhen('nonsense', now)).toBe('');
  });
  it('keeps the full date and time for the tooltip, in UK time', () => {
    expect(updateWhenFull('2026-07-03T13:20:00+00:00')).toBe('3 Jul 2026, 14:20');
  });
});

describe('changeLine', () => {
  const team = [
    { slug: 'ben-mcadam', name: 'Ben McAdam' },
    { slug: 'sam-example', name: 'Sam Example' },
  ];
  const entry = (kind: 'note' | 'auto' | 'handover', text: string, at = '2026-11-30T10:00:00+00:00') => ({
    kind,
    at,
    by: kind === 'handover' ? null : 'ben-mcadam',
    byName: 'Ben McAdam',
    text,
    via: null,
    action: null,
  });

  it('says a note as "added an update", never its text, and counts the rest', () => {
    const change = {
      entries: [
        entry('note', 'Secret words.'),
        entry('auto', 'changed the details', '2026-11-30T09:00:00+00:00'),
      ],
      finished: null,
      count: 2,
      at: '2026-11-30T10:00:00+00:00',
    };
    expect(changeLine(change, team)).toEqual({
      text: 'Ben McAdam added an update',
      at: '2026-11-30T10:00:00+00:00',
      more: 1,
    });
  });

  it('says automatic and handover lines as the log does, with names for slugs', () => {
    const auto = {
      entries: [entry('auto', 'changed the due date to 3 Dec 2026')],
      finished: null,
      count: 1,
      at: 'x',
    };
    expect(changeLine(auto, team).text).toBe('Ben McAdam changed the due date to 3 Dec 2026');
    const back = {
      entries: [entry('handover', 'handed it back to sam-example')],
      finished: null,
      count: 1,
      at: 'x',
    };
    expect(changeLine(back, team).text).toBe('Ben McAdam handed it back to Sam Example');
    const pass = {
      entries: [entry('handover', 'passed it from ben-mcadam to sam-example')],
      finished: null,
      count: 1,
      at: 'x',
    };
    expect(changeLine(pass, team).text).toBe('Ben McAdam passed it to Sam Example');
  });

  it('says a finish when that is the newest thing, with or without a name', () => {
    const done = {
      entries: [entry('note', 'All sent.')],
      finished: { at: '2026-11-30T10:00:20+00:00', byName: 'Ben McAdam' },
      count: 2,
      at: '2026-11-30T10:00:20+00:00',
    };
    expect(changeLine(done, team)).toEqual({
      text: 'Ben McAdam marked it as done',
      at: '2026-11-30T10:00:20+00:00',
      more: 1,
    });
    const nameless = { entries: [], finished: { at: 'x', byName: null }, count: 1, at: 'x' };
    expect(changeLine(nameless, team).text).toBe('Someone marked it as done');
  });
});

describe('a task you handed back, on the Asked tab', () => {
  const base: Pick<AskedTodo, 'state' | 'assigneeName' | 'asked' | 'done' | 'handedBack'> = {
    state: 'waiting',
    assigneeName: 'Ben McAdam',
    asked: { slug: 'sam-example', name: 'Sam Example', at: '2026-11-13T12:00:00+00:00', source: 'stamp' },
    done: null,
  };

  it('says "Handed back to <name>, <date>" instead of "With <name> since <date>"', () => {
    const back = { ...base, handedBack: true as const };
    expect(askedStatusLine(back)).toBe('Handed back to Ben McAdam, 13 Nov');
    expect(askedMeta(back)).toBe('Handed back to Ben, 13 Nov');
  });

  it('keeps "With" for every other task', () => {
    expect(askedStatusLine(base)).toBe('With Ben McAdam since 13 Nov');
    expect(askedMeta(base)).toBe('With Ben since 13 Nov');
  });
});

describe('todosRailLabel', () => {
  it('says "new or updated" for the count, which holds both', () => {
    expect(todosRailLabel(5, 3)).toBe('Tasks, 5 of yours, 3 new or updated');
    expect(todosRailLabel(5, 0)).toBe('Tasks, 5 of yours');
    expect(todosRailLabel(0, 0)).toBeUndefined();
  });
});
