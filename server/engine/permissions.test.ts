import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import {
  describeSessionAllow,
  HIDDEN_CHARS_WARNING,
  narrowSuggestions,
  permissionCard,
} from './permissions.ts';

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

const allowRule = (toolName: string, ruleContent?: string): PermissionUpdate => ({
  type: 'addRules',
  rules: [ruleContent === undefined ? { toolName } : { toolName, ruleContent }],
  behavior: 'allow',
  destination: 'session',
});

const label = (u: PermissionUpdate[]) => describeSessionAllow(u);
const sentence = (parts: string) => `For the rest of this chat, Claude won't ask before ${parts}.`;

describe('describeSessionAllow (A13: one full sentence, all that it grants)', () => {
  it('is null when nothing is kept', () => {
    expect(label([])).toBeNull();
  });

  it('names command rules as running …', () => {
    expect(label([allowRule('Bash', 'node .claude/skills/time/:*')])).toBe(
      sentence('running `node .claude/skills/time/...` commands'),
    );
    expect(label([allowRule('Bash', 'ls *')])).toBe(sentence('running `ls` commands'));
    expect(label([allowRule('Bash', 'git status')])).toBe(sentence('running the command `git status`'));
    expect(label([allowRule('Bash')])).toBe(sentence('running any command'));
  });

  it('names file, web, skill and connector rules', () => {
    expect(label([allowRule('Read')])).toBe(sentence('reading files'));
    expect(label([allowRule('Read', '/a/**')])).toBe(sentence('reading /a/**'));
    expect(label([allowRule('Edit')])).toBe(sentence('changing files'));
    expect(label([allowRule('Write', 'clients/**')])).toBe(sentence('changing clients/**'));
    expect(label([allowRule('WebFetch', 'domain:example.com')])).toBe(
      sentence('opening pages on example.com'),
    );
    expect(label([allowRule('WebFetch')])).toBe(sentence('opening web pages'));
    expect(label([allowRule('WebSearch')])).toBe(sentence('searching the web'));
    expect(label([allowRule('Grep')])).toBe(sentence('searching files'));
    expect(label([allowRule('Skill', 'gm')])).toBe(sentence('using the gm skill'));
    expect(label([allowRule('mcp__claude_ai_Gmail__create_draft')])).toBe(
      sentence('using create_draft from Gmail'),
    );
    expect(label([allowRule('mcp__slack')])).toBe(sentence('using everything from slack'));
  });

  it('names a folder and says plainly what edit mode lets through', () => {
    expect(
      label([{ type: 'addDirectories', directories: ['/Users/x/Downloads'], destination: 'session' }]),
    ).toBe(sentence('using files in /Users/x/Downloads'));
    expect(label([{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }])).toBe(
      sentence('creating, changing, moving and deleting files in the brain folder'),
    );
  });

  it('joins several items into one sentence', () => {
    expect(
      label([
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
    ).toBe(
      sentence(
        'running `ls` commands, reading /a/** and creating, changing, moving and deleting files in the brain folder',
      ),
    );
  });
});

const BRAIN = '/b/brain';
const card = (
  tool: string,
  input: Record<string, unknown>,
  ctx: { title?: string; blockedPath?: string } = {},
) => permissionCard(tool, input, { ...ctx, brainRoot: BRAIN });

describe('permissionCard', () => {
  it('uses the engine title when given', () => {
    expect(
      card('Write', { file_path: `${BRAIN}/out.txt` }, { title: 'Claude wants to write out.txt' }),
    ).toMatchObject({
      title: 'Claude wants to write out.txt',
      detail: 'out.txt',
      warning: null,
    });
  });

  it('builds a plain sentence and detail per tool otherwise', () => {
    expect(card('Write', { file_path: `${BRAIN}/clients/acme/notes.md`, content: 'x' })).toEqual({
      title: 'Claude wants to save a file',
      detail: 'clients/acme/notes.md',
      warning: null,
      refuse: false,
      change: { kind: 'new-file', parts: [{ everyMatch: false, lines: [{ kind: 'added', text: 'x' }] }] },
    });
    expect(card('Edit', { file_path: `${BRAIN}/b.md` }).title).toBe('Claude wants to change a file');
    expect(card('Bash', { command: 'git push', description: 'Push' })).toMatchObject({
      title: 'Claude wants to run a command',
      detail: 'git push',
      warning: null,
    });
    expect(card('WebFetch', { url: 'https://example.com/a' })).toMatchObject({
      title: 'Claude wants to open a web page',
      detail: 'https://example.com/a',
    });
    expect(card('WebSearch', { query: 'uk vat rate' }).detail).toBe('uk vat rate');
    expect(card('mcp__claude_ai_Gmail__create_draft', { to: 'a@b.c' }).title).toBe(
      'Claude wants to use create_draft from Gmail',
    );
    expect(card('Skill', { skill: 'gm' }).title).toBe('Claude wants to use the gm skill');
    expect(card('Skill', {}).title).toBe('Claude wants to use a skill');
  });

  it('treats a relative path as inside the brain folder', () => {
    expect(card('Write', { file_path: 'todo/x.md' })).toMatchObject({ detail: 'todo/x.md', warning: null });
  });

  it('keeps the full path and warns for a file outside the brain, including a .. escape', () => {
    expect(card('Write', { file_path: '/etc/hosts' })).toMatchObject({
      detail: '/etc/hosts',
      warning: 'This file is outside the brain folder.',
    });
    expect(card('Write', { file_path: `${BRAIN}/../brain-evil/x.md` })).toMatchObject({
      detail: '/b/brain-evil/x.md',
      warning: 'This file is outside the brain folder.',
    });
    expect(card('Write', { file_path: `${BRAIN}-copy/x.md` }).warning).toBe(
      'This file is outside the brain folder.',
    );
  });

  it('treats a blocked path the same way', () => {
    const c = card('Bash', { command: 'cat /etc/hosts' }, { blockedPath: '/etc/hosts' });
    expect(c.detail).toContain('cat /etc/hosts');
    expect(c.warning).toBe('This file is outside the brain folder.');
    expect(card('Bash', { command: 'cat x' }, { blockedPath: `${BRAIN}/x` }).warning).toBeNull();
  });

  it('never clips silently: long details are shown in full up to 20,000 characters', () => {
    const c = card('Mystery', { a: 'x'.repeat(15_000) });
    expect(c.title).toBe('Claude wants to use Mystery');
    expect(c.detail).toContain('x'.repeat(15_000));
    expect(c.warning).toBeNull();
  });

  it('shortens a longer detail only with a plain warning saying so', () => {
    const c = card('Mystery', { a: 'x'.repeat(30_000) });
    expect(c.detail.length).toBeLessThanOrEqual(20_001);
    expect(c.warning).toMatch(
      /^This is too long to show in full \([\d,]+ characters\)\. Only allow it if you know what Claude is doing\.$/,
    );
    expect(c.refuse).toBe(false);
  });

  it('marks an over-long command to be refused, never shortened', () => {
    const c = card('Bash', { command: `echo ${'x'.repeat(20_001)}` });
    expect(c.refuse).toBe(true);
  });

  it('joins both warnings into one string', () => {
    const c = card('Write', { file_path: `/tmp/${'d/'.repeat(10_001)}x.md` });
    expect(c.warning).toContain('This file is outside the brain folder.');
    expect(c.warning).toContain('too long to show in full');
  });

  it('warns about a long or many-line command, joined with any other warning', () => {
    const LONG = 'This is a long command. Scroll to the end before you allow it.';
    expect(card('Bash', { command: `echo ${'x'.repeat(595)}` }).warning).toBeNull();
    expect(card('Bash', { command: `echo ${'x'.repeat(596)}` }).warning).toBe(LONG);
    expect(
      card('Bash', { command: Array.from({ length: 8 }, (_, i) => `echo ${i}`).join('\n') }).warning,
    ).toBeNull();
    expect(
      card('Bash', { command: Array.from({ length: 9 }, (_, i) => `echo ${i}`).join('\n') }).warning,
    ).toBe(LONG);
    const both = card('Bash', { command: `cat ${'y'.repeat(700)}` }, { blockedPath: '/etc/hosts' });
    expect(both.warning).toContain('This file is outside the brain folder.');
    expect(both.warning).toContain(LONG);
    expect(card('Bash', { command: `echo ${'x'.repeat(20_001)}` }).refuse).toBe(true);
  });
});

describe('permissionCard: the change a file tool will make', () => {
  it('shows the lines an Edit removes and adds, with the path still as the detail', () => {
    const c = card('Edit', {
      file_path: `${BRAIN}/clients/acme/profile.md`,
      old_string: 'Phone: 0161 000 0000',
      new_string: 'Phone: 0161 111 1111',
    });
    expect(c.detail).toBe('clients/acme/profile.md');
    expect(c.change).toEqual({
      kind: 'edit',
      parts: [
        {
          everyMatch: false,
          lines: [
            { kind: 'removed', text: 'Phone: 0161 000 0000' },
            { kind: 'added', text: 'Phone: 0161 111 1111' },
          ],
        },
      ],
    });
    expect(c.warning).toBeNull();
  });

  it('says whether a Write makes a new file or replaces one that is there', () => {
    const dir = mkdtempSync(join(tmpdir(), 'perm-card-'));
    try {
      writeFileSync(join(dir, 'there.md'), 'old');
      const at = (file_path: string) =>
        permissionCard('Write', { file_path, content: 'new' }, { brainRoot: dir }).change?.kind;
      expect(at(join(dir, 'there.md'))).toBe('replace-file');
      expect(at('there.md')).toBe('replace-file');
      expect(at(join(dir, 'not-yet.md'))).toBe('new-file');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('has no change for other tools, or for a file tool whose input it cannot read', () => {
    expect(card('Bash', { command: 'ls' }).change).toBeNull();
    expect(card('Read', { file_path: `${BRAIN}/a.md` }).change).toBeNull();
    expect(card('Edit', { file_path: `${BRAIN}/a.md` }).change).toBeNull();
  });

  it('warns when the change was too long to show in full, giving its lines and characters', () => {
    const c = card('Write', { file_path: `${BRAIN}/big.txt`, content: 'z'.repeat(60_000) });
    expect(c.change?.kind).toBe('new-file');
    expect(c.warning).toBe(
      'This change is too long to show in full (1 line, 60,001 characters). Only allow it if you know what Claude is doing.',
    );
    const padded = card('Write', { file_path: `${BRAIN}/notes.md`, content: `Hi\n${'\n'.repeat(5_000)}x` });
    expect(padded.warning).toMatch(/^This change is too long to show in full \(5,002 lines, /);
  });

  it('warns about hidden characters, which are shown as visible codes', () => {
    const c = card('Edit', {
      file_path: `${BRAIN}/clients/acme/bank.md`,
      old_string: 'Account: 12345678',
      new_string: 'Account: ‮87654321',
    });
    expect(c.warning).toBe(HIDDEN_CHARS_WARNING);
    expect(HIDDEN_CHARS_WARNING).toContain('⟨U+202E⟩');
    expect(card('Edit', { file_path: `${BRAIN}/a.md`, old_string: 'a', new_string: 'b' }).warning).toBeNull();
  });

  it('joins the too-long warning with the outside-the-brain one', () => {
    const c = card('Write', { file_path: '/etc/big.txt', content: 'z'.repeat(60_000) });
    expect(c.warning).toContain('This file is outside the brain folder.');
    expect(c.warning).toContain('This change is too long to show in full');
  });
});

describe('attached files (decision 10)', () => {
  const UPLOADS = '/d/data/uploads';
  const withUploads = (tool: string, input: Record<string, unknown>, ctx: { blockedPath?: string } = {}) =>
    permissionCard(tool, input, { ...ctx, brainRoot: BRAIN, uploadsRoot: UPLOADS });

  it('names a file in the uploads folder plainly, with no outside-the-brain warning', () => {
    expect(withUploads('Read', { file_path: `${UPLOADS}/1234/report.pdf` })).toMatchObject({
      title: 'Claude wants to read a file',
      detail: 'Attached file: report.pdf',
      warning: null,
    });
    expect(withUploads('Grep', { pattern: 'x', path: `${UPLOADS}/1234` })).toMatchObject({
      detail: 'x\nAttached files',
      warning: null,
    });
    const bash = withUploads('Bash', { command: 'cp a b' }, { blockedPath: `${UPLOADS}/1234/a b.png` });
    expect(bash.detail).toBe('cp a b\n\nPath: Attached file: a b.png');
    expect(bash.warning).toBeNull();
  });

  it('still warns about a path that only looks like the uploads folder, or escapes it', () => {
    expect(withUploads('Read', { file_path: `${UPLOADS}-evil/1234/x.pdf` }).warning).toBe(
      'This file is outside the brain folder.',
    );
    expect(withUploads('Read', { file_path: `${UPLOADS}/../secret.json` })).toMatchObject({
      detail: '/d/data/secret.json',
      warning: 'This file is outside the brain folder.',
    });
  });

  it('is unchanged without an uploads folder', () => {
    expect(
      permissionCard(
        'Read',
        { file_path: `${UPLOADS}/1234/report.pdf` },
        { brainRoot: BRAIN, uploadsRoot: null },
      ),
    ).toMatchObject({
      detail: `${UPLOADS}/1234/report.pdf`,
      warning: 'This file is outside the brain folder.',
    });
  });
});
