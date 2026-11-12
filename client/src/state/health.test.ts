import { describe, expect, it } from 'vitest';
import type { Bootstrap } from '../../../shared/contract.ts';
import { type HealthInput, healthChecks, healthSummary } from './health.ts';

const NOW = Date.parse('2026-11-12T17:30:00Z');

function boot(over: Partial<Bootstrap> = {}): Bootstrap {
  return {
    appVersion: '0',
    service: { underService: true },
    identity: { name: 'Ian', email: null, role: 'scout', knownMember: true, slug: 'ian' },
    profile: { title: null, departments: [], owns: null },
    brain: { ok: true, path: '/Users/x/agencybrain', problems: [] },
    engine: { ok: true, claudePath: '/usr/local/bin/claude', problem: null, permissionMode: 'default' },
    skills: [],
    clients: [],
    usedOften: [],
    prefs: { pins: [], directTodoEdits: false, singleKeyShortcuts: true },
    ...over,
  } as Bootstrap;
}

function input(over: Partial<HealthInput> = {}): HealthInput {
  return {
    boot: boot(),
    streamUp: true,
    lists: { todos: 'loaded', chats: 'loaded' },
    lastSync: new Date(NOW - 60_000).toISOString(),
    now: NOW,
    ...over,
  };
}

const byId = (i: HealthInput, id: string) => healthChecks(i).find((c) => c.id === id);

describe('healthChecks', () => {
  it('says everything is fine when it is', () => {
    const checks = healthChecks(input());
    expect(checks.map((c) => c.id)).toEqual([
      'connection',
      'brain',
      'claude',
      'sync',
      'lists',
      'service',
      'signin',
    ]);
    expect(checks.every((c) => c.state === 'ok')).toBe(true);
    expect(healthSummary(checks)).toEqual({ state: 'ok', text: 'Everything is connected and working.' });
  });

  it('reports a dropped live connection', () => {
    const c = byId(input({ streamUp: false }), 'connection');
    expect(c?.state).toBe('problem');
    expect(c?.text).toMatch(/^Lost the live connection/);
  });

  it('ends each brain problem as a sentence', () => {
    const c = byId(
      input({ boot: boot({ brain: { ok: false, path: '/b', problems: ['No team list found'] } }) }),
      'brain',
    );
    expect(c?.text).toBe('No team list found. Tell whoever looks after TDS Brain.');
  });

  it("passes on the brain's own problems", () => {
    const c = byId(
      input({
        boot: boot({ brain: { ok: false, path: '/b', problems: ['No team list found.', 'No whoami.'] } }),
      }),
      'brain',
    );
    expect(c?.state).toBe('problem');
    expect(c?.text).toBe('No team list found. No whoami. Tell whoever looks after TDS Brain.');
    expect(c?.detail).toBe('/b');
  });

  it("passes on Claude Code's problem, with a fallback", () => {
    const off = boot({ engine: { ok: false, claudePath: null, problem: null, permissionMode: 'default' } });
    expect(byId(input({ boot: off }), 'claude')).toMatchObject({
      state: 'problem',
      text: "Claude Code isn't ready.",
    });
  });

  it('treats a stale or missing sync as a problem, and an unknown one as still checking', () => {
    expect(byId(input({ lastSync: new Date(NOW - 20 * 60_000).toISOString() }), 'sync')?.state).toBe(
      'problem',
    );
    expect(byId(input({ lastSync: null }), 'sync')?.state).toBe('problem');
    expect(byId(input({ lastSync: undefined }), 'sync')?.state).toBe('checking');
  });

  it('names which list failed to load', () => {
    expect(byId(input({ lists: { todos: 'failed', chats: 'loaded' } }), 'lists')?.text).toMatch(
      /^Your to-dos/,
    );
    expect(byId(input({ lists: { todos: 'loaded', chats: 'failed' } }), 'lists')?.text).toMatch(
      /^Your chats/,
    );
    expect(byId(input({ lists: { todos: 'failed', chats: 'failed' } }), 'lists')?.text).toMatch(
      /^Your to-dos and chats/,
    );
    expect(byId(input({ lists: { todos: 'loading', chats: 'loaded' } }), 'lists')?.state).toBe('checking');
  });

  it('notes, but does not count as a problem, a copy started from Terminal', () => {
    const i = input({ boot: boot({ service: { underService: false } }) });
    expect(byId(i, 'service')?.state).toBe('note');
    expect(healthSummary(healthChecks(i)).state).toBe('ok');
  });
});

describe('healthSummary', () => {
  it('counts problems in plain words', () => {
    expect(healthSummary(healthChecks(input({ streamUp: false }))).text).toBe(
      '1 thing needs attention: Connection.',
    );
    expect(healthSummary(healthChecks(input({ streamUp: false, lastSync: null }))).text).toBe(
      '2 things need attention: Connection and Brain sync.',
    );
    const off = boot({ engine: { ok: false, claudePath: null, problem: null, permissionMode: 'default' } });
    expect(healthSummary(healthChecks(input({ boot: off, streamUp: false, lastSync: null }))).text).toBe(
      '3 things need attention: Connection, Claude Code and Brain sync.',
    );
  });

  it('says it is still checking until every check has an answer', () => {
    expect(healthSummary(healthChecks(input({ lastSync: undefined })))).toEqual({
      state: 'checking',
      text: 'Checking everything is connected…',
    });
  });

  it('puts problems ahead of checking', () => {
    expect(healthSummary(healthChecks(input({ lastSync: undefined, streamUp: false }))).state).toBe(
      'problem',
    );
  });
});
