import { describe, expect, it } from 'vitest';
import {
  CONTEXT_THRESHOLDS,
  type KeepModelInput,
  meterBand,
  REANCHOR_CLOSING_LINE,
} from '../../shared/context-contract.ts';
import { contextItems, contextReading, reanchorText, shouldKeepModel } from './context-policy.ts';

const base: KeepModelInput = {
  explicit: false,
  fromTier: 'deep',
  toTier: 'standard',
  cacheWarm: true,
  estimatedUsd: 0.4,
  usedTokens: null,
  lowerWantedTurns: 1,
  targetRecentlyUsed: false,
};

describe('shouldKeepModel (decision 10)', () => {
  it('keeps an automatic downward switch when the cache is warm and re-reading costs $0.10 or more', () => {
    expect(shouldKeepModel(base)).toBe(true);
    expect(shouldKeepModel({ ...base, estimatedUsd: CONTEXT_THRESHOLDS.keepModelMinUsd })).toBe(true);
  });

  it('always switches upward, sideways, or when the person chose it', () => {
    expect(shouldKeepModel({ ...base, fromTier: 'standard', toTier: 'deep' })).toBe(false);
    expect(shouldKeepModel({ ...base, fromTier: 'standard', toTier: 'standard' })).toBe(false);
    expect(shouldKeepModel({ ...base, explicit: true })).toBe(false);
  });

  it('switches when the re-read is cheap or the cache is cold', () => {
    expect(shouldKeepModel({ ...base, estimatedUsd: 0.02 })).toBe(false);
    expect(shouldKeepModel({ ...base, cacheWarm: false })).toBe(false);
  });

  it('switches when the lower level has been wanted three turns running', () => {
    expect(shouldKeepModel({ ...base, lowerWantedTurns: CONTEXT_THRESHOLDS.keepModelMaxTurns - 1 })).toBe(
      true,
    );
    expect(shouldKeepModel({ ...base, lowerWantedTurns: CONTEXT_THRESHOLDS.keepModelMaxTurns })).toBe(false);
  });

  it('switches back to a model that answered this chat within the cache TTL', () => {
    expect(shouldKeepModel({ ...base, targetRecentlyUsed: true })).toBe(false);
  });

  it('fallback (no estimate): keeps a warm chat at or above the token floor only', () => {
    const fb = { ...base, estimatedUsd: null };
    expect(shouldKeepModel({ ...fb, usedTokens: CONTEXT_THRESHOLDS.fallbackMinTokens })).toBe(true);
    expect(shouldKeepModel({ ...fb, usedTokens: CONTEXT_THRESHOLDS.fallbackMinTokens - 1 })).toBe(false);
    expect(shouldKeepModel({ ...fb, usedTokens: null })).toBe(false);
    expect(shouldKeepModel({ ...fb, usedTokens: 90_000, cacheWarm: false })).toBe(false);
    expect(shouldKeepModel({ ...fb, usedTokens: 90_000, lowerWantedTurns: 3 })).toBe(false);
  });
});

describe('reanchorText (decision 8)', () => {
  it('puts the to-do first, then the newest files, then working helpers, then the closing line', () => {
    const text = reanchorText({
      todo: { title: 'Acme audit', path: 'todo/20261114-acme.md' },
      files: ['clients/acme/reports/audit.md', 'clients/acme/profile.md'],
      workingHelpers: ['Scout: read the reports'],
    });
    const lines = text.split('\n');
    expect(lines[0]).toContain('Acme audit');
    expect(lines[0]).toContain('todo/20261114-acme.md');
    expect(text.indexOf('clients/acme/reports/audit.md')).toBeLessThan(
      text.indexOf('clients/acme/profile.md'),
    );
    expect(text.indexOf('clients/acme/profile.md')).toBeLessThan(text.indexOf('Scout: read the reports'));
    expect(text.endsWith(REANCHOR_CLOSING_LINE)).toBe(true);
  });

  it('is only the closing line when there is nothing else', () => {
    expect(reanchorText({ todo: null, files: [], workingHelpers: [] })).toBe(REANCHOR_CLOSING_LINE);
  });

  it('never exceeds the cap, keeps the to-do and the closing line, and drops the oldest files first', () => {
    const files = Array.from({ length: 200 }, (_, i) => `clients/acme/notes/file-${i}.md`);
    const text = reanchorText({
      todo: { title: 'T'.repeat(5000), path: 'todo/x.md' },
      files,
      workingHelpers: ['Worker'],
    });
    expect(text.length).toBeLessThanOrEqual(CONTEXT_THRESHOLDS.reanchorMaxChars);
    expect(text.endsWith(REANCHOR_CLOSING_LINE)).toBe(true);
    expect(text.startsWith('To-do')).toBe(true);
    const shortTodo = reanchorText({
      todo: { title: 'Short', path: 'todo/x.md' },
      files,
      workingHelpers: [],
    });
    expect(shortTodo.length).toBeLessThanOrEqual(CONTEXT_THRESHOLDS.reanchorMaxChars);
    expect(shortTodo).toContain('file-0.md');
    expect(shortTodo).not.toContain('file-199.md');
  });
});

describe('meterBand (decision 5)', () => {
  it('is ok below 60, warn from 60, full from 85', () => {
    expect(meterBand(0)).toBe('ok');
    expect(meterBand(59)).toBe('ok');
    expect(meterBand(60)).toBe('warn');
    expect(meterBand(84)).toBe('warn');
    expect(meterBand(85)).toBe('full');
    expect(meterBand(130)).toBe('full');
  });
});

describe('contextItems (decisions 6 and 12)', () => {
  const full = {
    totalTokens: 60_000,
    rawMaxTokens: 1_000_000,
    autoCompactThreshold: 967_000,
    isAutoCompactEnabled: true,
    categories: [
      { id: 'system_prompt', name: 'System prompt', tokens: 14_000, kind: 'used' },
      { id: 'system_tools', name: 'System tools', tokens: 8_000, kind: 'used' },
      { id: 'mcp_tools', name: 'MCP tools', tokens: 2_500, kind: 'used' },
      { id: 'mcp_instructions', name: 'MCP instructions', tokens: 3_300, kind: 'used' },
      { id: 'mcp_tools_deferred', name: 'MCP tools (deferred)', tokens: 321_000, kind: 'deferred' },
      { id: 'custom_agents', name: 'Custom agents', tokens: 1_800, kind: 'used' },
      { id: 'memory_files', name: 'Memory files', tokens: 3_600, kind: 'used' },
      { id: 'skills', name: 'Skills', tokens: 9_300, kind: 'used' },
      { id: 'messages', name: 'Messages', tokens: 18_000, kind: 'used' },
      { id: 'autocompact_buffer', name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' },
      { id: 'free_space', name: 'Free space', tokens: 907_000, kind: 'free' },
      { name: 'Something new', tokens: 0, kind: 'used' },
    ],
    memoryFiles: [
      { path: '/Users/x/.claude/CLAUDE.md', type: 'User', tokens: 2_600 },
      { path: '/brain/CLAUDE.md', type: 'Project', tokens: 1_000 },
    ],
    mcpTools: [
      { name: 'mcp__claude_ai_Gmail__send', serverName: 'claude_ai_Gmail', tokens: 2_500, isLoaded: true },
      { name: 'mcp__claude_ai_Vercel__x', serverName: 'claude_ai_Vercel', tokens: 194_000, isLoaded: false },
      {
        name: 'mcp__claude_ai_monday_com__y',
        serverName: 'claude_ai_monday_com',
        tokens: 127_000,
        isLoaded: false,
      },
    ],
    mcpInstructions: [{ serverName: 'claude.ai Gmail', tokens: 3_300 }],
    agents: [],
    skills: { totalSkills: 151, includedSkills: 151, tokens: 9_300, skillFrontmatter: [] },
    messageBreakdown: {
      attachmentsByType: [
        { name: 'hook_success', tokens: 6_000 },
        { name: 'hook_additional_context', tokens: 1_200 },
        { name: 'file', tokens: 500 },
      ],
    },
  };

  it('groups by id and kind, largest first, at most 12, with no zero rows', () => {
    const items = contextItems(full);
    expect(items.length).toBeLessThanOrEqual(12);
    expect(items.every((i) => i.tokens > 0)).toBe(true);
    for (let i = 1; i < items.length; i++)
      expect(items[i - 1]?.tokens ?? 0).toBeGreaterThanOrEqual(items[i]?.tokens ?? 0);
    expect(items.find((i) => i.group === 'free')?.tokens).toBe(907_000);
    expect(items.find((i) => i.group === 'buffer')?.tokens).toBe(33_000);
    expect(items.find((i) => i.group === 'system' && i.name === 'System prompt')?.tokens).toBe(14_000);
  });

  it('splits start-up hook text out of messages and advises on it', () => {
    const items = contextItems(full);
    const hooks = items.find((i) => i.name.startsWith('Start-up text'));
    expect(hooks?.tokens).toBe(7_200);
    expect(hooks?.advice).toBe(
      "Start-up text from your plugins: about 7k tokens in every chat. If you don't need a plugin here, turn it off in Claude's settings.",
    );
    expect(items.find((i) => i.group === 'messages')?.tokens).toBe(18_000 - 7_200);
  });

  it('gives each loaded connector one row with its tools and instructions, and advice above 2k', () => {
    const gmail = contextItems(full).find((i) => i.group === 'connectors');
    expect(gmail?.name).toBe('Gmail connector');
    expect(gmail?.tokens).toBe(5_800);
    expect(gmail?.advice).toContain('Gmail');
  });

  it('lists deferred tool schemas as tools, never advised on', () => {
    const deferred = contextItems(full).filter((i) => i.deferred);
    expect(deferred.length).toBeGreaterThan(0);
    for (const d of deferred) {
      expect(d.group).toBe('tools');
      expect(d.advice).toBeUndefined();
    }
    expect(deferred.reduce((n, d) => n + d.tokens, 0)).toBe(321_000);
  });

  it('advises on the skill list and a personal memory file, not on the brain’s own', () => {
    const items = contextItems(full);
    expect(items.find((i) => i.group === 'skills')?.advice).toBeTruthy();
    const mem = items.filter((i) => i.group === 'memory');
    expect(mem.find((m) => m.tokens === 2_600)?.advice).toBeTruthy();
    expect(mem.find((m) => m.tokens === 1_000)?.advice).toBeUndefined();
    // Nothing under 2k is ever advised on.
    for (const i of items) if (i.tokens <= 2_000) expect(i.advice).toBeUndefined();
  });

  it('answers [] for junk', () => {
    expect(contextItems(null)).toEqual([]);
    expect(contextItems({ categories: 'x' })).toEqual([]);
  });
});

describe('contextReading (decisions 4 and 5)', () => {
  it('measures against the auto-summarise threshold, else the window', () => {
    expect(
      contextReading(
        {
          totalTokens: 48_350,
          rawMaxTokens: 1_000_000,
          autoCompactThreshold: 967_000,
          isAutoCompactEnabled: true,
        },
        7,
      ),
    ).toEqual({
      type: 'context',
      usedTokens: 48_350,
      limitTokens: 967_000,
      windowTokens: 1_000_000,
      percent: 5,
      autoCompact: true,
      source: 'engine',
      at: 7,
    });
    expect(
      contextReading(
        {
          totalTokens: 50_000,
          rawMaxTokens: 200_000,
          autoCompactThreshold: 167_000,
          isAutoCompactEnabled: false,
        },
        1,
      ),
    ).toMatchObject({ limitTokens: 200_000, percent: 25, autoCompact: false });
    expect(
      contextReading({ totalTokens: 50_000, rawMaxTokens: 200_000, isAutoCompactEnabled: true }, 1),
    ).toMatchObject({
      limitTokens: 200_000,
      autoCompact: false,
    });
  });

  it('answers null for a junk reading', () => {
    expect(contextReading(null, 1)).toBeNull();
    expect(contextReading({ totalTokens: 'x', rawMaxTokens: 10 }, 1)).toBeNull();
    expect(contextReading({ totalTokens: 5, rawMaxTokens: 0 }, 1)).toBeNull();
  });
});
