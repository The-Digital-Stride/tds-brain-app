import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { describeSessionAllow, narrowSuggestions, permissionCard } from './permissions.ts';

describe('narrowSuggestions (A1)', () => {
  const broad: PermissionUpdate[] = [
    {
      type: 'addRules',
      rules: [{ toolName: 'Bash', ruleContent: 'node:*' }],
      behavior: 'allow',
      destination: 'localSettings',
    },
    {
      type: 'addRules',
      rules: [{ toolName: 'Bash', ruleContent: 'rm:*' }],
      behavior: 'deny',
      destination: 'session',
    },
    { type: 'addRules', rules: [{ toolName: 'Read' }], behavior: 'ask', destination: 'session' },
    { type: 'replaceRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'userSettings' },
    { type: 'removeRules', rules: [{ toolName: 'Bash' }], behavior: 'deny', destination: 'projectSettings' },
    { type: 'setMode', mode: 'bypassPermissions', destination: 'session' },
    { type: 'setMode', mode: 'acceptEdits', destination: 'localSettings' },
    { type: 'setMode', mode: 'plan', destination: 'session' },
    { type: 'addDirectories', directories: ['/tmp/x'], destination: 'projectSettings' },
    { type: 'removeDirectories', directories: ['/tmp/y'], destination: 'session' },
  ];

  it('keeps only allow-addRules, addDirectories and setMode acceptEdits', () => {
    const kept = narrowSuggestions(broad, false);
    expect(kept.map((u) => u.type)).toEqual(['addRules', 'setMode', 'addDirectories']);
    expect(kept[0]).toMatchObject({
      behavior: 'allow',
      rules: [{ toolName: 'Bash', ruleContent: 'node:*' }],
    });
    expect(kept[1]).toMatchObject({ mode: 'acceptEdits' });
  });

  it('rewrites every destination to session', () => {
    for (const u of narrowSuggestions(broad, false)) expect(u.destination).toBe('session');
  });

  it('does not change the objects it was given', () => {
    narrowSuggestions(broad, false);
    expect(broad[0]?.destination).toBe('localSettings');
  });

  it('keeps nothing when suppressAlwaysAllowRule is set, or when there are no suggestions', () => {
    expect(narrowSuggestions(broad, true)).toEqual([]);
    expect(narrowSuggestions(undefined, false)).toEqual([]);
    expect(narrowSuggestions([], false)).toEqual([]);
  });

  it('drops malformed items', () => {
    const junk = [
      { type: 'addRules', behavior: 'allow', destination: 'session' },
      null,
      7,
    ] as unknown as PermissionUpdate[];
    expect(narrowSuggestions(junk, false)).toEqual([]);
  });
});

describe('describeSessionAllow (sessionAllowLabel)', () => {
  it('is null when nothing is kept', () => {
    expect(describeSessionAllow([])).toBeNull();
  });

  it('names what a command rule covers', () => {
    const label = describeSessionAllow([
      {
        type: 'addRules',
        rules: [{ toolName: 'Bash', ruleContent: 'node .claude/skills/time/:*' }],
        behavior: 'allow',
        destination: 'session',
      },
    ]);
    expect(label).toBe('Also allow `node .claude/skills/time/...` commands in this chat');
  });

  it('names an exact command, a tool, a web domain, a folder and edit mode', () => {
    expect(
      describeSessionAllow([
        {
          type: 'addRules',
          rules: [{ toolName: 'Bash', ruleContent: 'git status' }],
          behavior: 'allow',
          destination: 'session',
        },
      ]),
    ).toBe('Also allow the command `git status` in this chat');
    expect(
      describeSessionAllow([
        { type: 'addRules', rules: [{ toolName: 'WebSearch' }], behavior: 'allow', destination: 'session' },
      ]),
    ).toBe('Also allow web searches in this chat');
    expect(
      describeSessionAllow([
        {
          type: 'addRules',
          rules: [{ toolName: 'WebFetch', ruleContent: 'domain:example.com' }],
          behavior: 'allow',
          destination: 'session',
        },
      ]),
    ).toBe('Also allow opening pages on example.com in this chat');
    expect(
      describeSessionAllow([
        { type: 'addDirectories', directories: ['/Users/x/Downloads'], destination: 'session' },
      ]),
    ).toBe('Also allow access to files in /Users/x/Downloads in this chat');
    expect(describeSessionAllow([{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }])).toBe(
      'Also allow file edits without asking in this chat',
    );
    expect(
      describeSessionAllow([
        {
          type: 'addRules',
          rules: [{ toolName: 'mcp__claude_ai_Gmail__create_draft' }],
          behavior: 'allow',
          destination: 'session',
        },
      ]),
    ).toBe('Also allow create_draft from Gmail in this chat');
  });

  it('joins several items into one sentence', () => {
    expect(
      describeSessionAllow([
        {
          type: 'addRules',
          rules: [
            { toolName: 'Bash', ruleContent: 'ls:*' },
            { toolName: 'Read', ruleContent: '/a/**' },
          ],
          behavior: 'allow',
          destination: 'session',
        },
        { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
      ]),
    ).toBe('Also allow `ls` commands, reading /a/** and file edits without asking in this chat');
  });
});

describe('permissionCard', () => {
  it('uses the engine title when given', () => {
    const card = permissionCard(
      'Write',
      { file_path: '/a/out.txt' },
      { title: 'Claude wants to write out.txt' },
    );
    expect(card).toEqual({ title: 'Claude wants to write out.txt', detail: '/a/out.txt' });
  });

  it('builds a plain sentence and detail per tool otherwise', () => {
    expect(permissionCard('Write', { file_path: '/a/out.txt', content: 'x' }, {})).toEqual({
      title: 'Claude wants to save a file',
      detail: '/a/out.txt',
    });
    expect(permissionCard('Edit', { file_path: '/a/b.md' }, {}).title).toBe('Claude wants to change a file');
    expect(permissionCard('Bash', { command: 'git push', description: 'Push' }, {})).toEqual({
      title: 'Claude wants to run a command',
      detail: 'git push',
    });
    expect(permissionCard('WebFetch', { url: 'https://example.com/a' }, {})).toEqual({
      title: 'Claude wants to open a web page',
      detail: 'https://example.com/a',
    });
    expect(permissionCard('WebSearch', { query: 'uk vat rate' }, {}).detail).toBe('uk vat rate');
    expect(permissionCard('mcp__claude_ai_Gmail__create_draft', { to: 'a@b.c' }, {}).title).toBe(
      'Claude wants to use create_draft from Gmail',
    );
    expect(permissionCard('Skill', { skill: 'gm' }, {}).title).toBe('Claude wants to use the gm skill');
  });

  it('falls back to the input as text, trimmed, for an unknown tool', () => {
    const card = permissionCard('Mystery', { a: 'x'.repeat(5000) }, {});
    expect(card.title).toBe('Claude wants to use Mystery');
    expect(card.detail.length).toBeLessThanOrEqual(2001);
  });

  it('mentions a blocked path when the engine gives one', () => {
    const card = permissionCard('Bash', { command: 'cat /etc/hosts' }, { blockedPath: '/etc/hosts' });
    expect(card.detail).toContain('cat /etc/hosts');
    expect(card.detail).toContain('/etc/hosts');
  });
});
