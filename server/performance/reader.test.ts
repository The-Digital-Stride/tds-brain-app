import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listLogFiles, localDate, PerformanceError, readLogFile } from './reader.ts';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'perf-reader-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const noon = (d: number) => new Date(2026, 10, d, 12, 0, 0).toISOString();
const usage = (o: Partial<Record<string, unknown>> = {}) => ({
  input_tokens: 10,
  cache_creation_input_tokens: 100,
  cache_creation: { ephemeral_5m_input_tokens: 60, ephemeral_1h_input_tokens: 40 },
  cache_read_input_tokens: 1000,
  output_tokens: 5,
  ...o,
});
function line(over: {
  id?: string;
  model?: string;
  ts?: string;
  usage?: unknown;
  content?: unknown[];
  cwd?: string;
  gitBranch?: string;
}) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: over.ts ?? noon(20),
    cwd: over.cwd ?? '/Users/x/repo',
    gitBranch: over.gitBranch ?? 'main',
    message: {
      id: over.id ?? 'm1',
      model: over.model ?? 'claude-opus-5-5',
      usage: 'usage' in over ? over.usage : usage(),
      content: over.content ?? [{ type: 'text', text: 'SECRET WORDS' }],
    },
  });
}
const write = (name: string, lines: string[]) => writeFile(join(root, name), `${lines.join('\n')}\n`);

describe('readLogFile', () => {
  it('counts one request per message id and the last line wins', async () => {
    await write('a.jsonl', [
      line({ id: 'm1', usage: usage({ output_tokens: 1 }) }),
      line({ id: 'm1', usage: usage({ output_tokens: 99 }) }),
      line({ id: 'm2' }),
    ]);
    const r = await readLogFile(join(root, 'a.jsonl'));
    expect(r.reqs.size).toBe(2);
    expect(r.reqs.get('m1')?.[6]).toBe(99);
  });

  it('skips synthetic entries and entries without usage', async () => {
    await write('a.jsonl', [
      line({ id: 's', model: '<synthetic>', usage: usage({ input_tokens: 0, output_tokens: 0 }) }),
      line({ id: 'n', usage: null }),
      line({ id: 'ok' }),
    ]);
    const r = await readLogFile(join(root, 'a.jsonl'));
    expect([...r.reqs.keys()]).toEqual(['ok']);
  });

  it('parses only assistant lines', async () => {
    await write('a.jsonl', [
      JSON.stringify({ type: 'user', message: { id: 'u', model: 'x', usage: usage() }, cwd: '/nope' }),
      '{not json at all "type":"assistant"',
      line({ id: 'a' }),
    ]);
    const r = await readLogFile(join(root, 'a.jsonl'));
    expect([...r.reqs.keys()]).toEqual(['a']);
    expect(r.cwd).toBe('/Users/x/repo');
  });

  it('splits 5-minute and 1-hour cache writes, and falls back to 5-minute', async () => {
    await write('a.jsonl', [
      line({ id: 'a' }),
      line({
        id: 'b',
        usage: {
          input_tokens: 1,
          cache_creation_input_tokens: 70,
          cache_read_input_tokens: 0,
          output_tokens: 2,
        },
      }),
    ]);
    const r = await readLogFile(join(root, 'a.jsonl'));
    expect(r.reqs.get('a')).toEqual([localDate(noon(20)), 'claude-opus-5-5', 10, 60, 40, 1000, 5]);
    expect(r.reqs.get('b')?.slice(2)).toEqual([1, 70, 0, 0, 2]);
  });

  it('marks Code Mode when any line of the session calls REPL', async () => {
    await write('a.jsonl', [
      line({ id: 'a', content: [{ type: 'text', text: 'hi' }] }),
      line({ id: 'a', content: [{ type: 'tool_use', name: 'REPL', input: { code: 'x' } }] }),
    ]);
    expect((await readLogFile(join(root, 'a.jsonl'))).codeMode).toBe(true);
    await write('b.jsonl', [line({ id: 'a', content: [{ type: 'tool_use', name: 'Bash', input: {} }] })]);
    expect((await readLogFile(join(root, 'b.jsonl'))).codeMode).toBe(false);
  });

  it('uses the local date of the message', async () => {
    const ts = new Date(2026, 10, 27, 23, 30).toISOString();
    await write('a.jsonl', [line({ id: 'a', ts })]);
    expect((await readLogFile(join(root, 'a.jsonl'))).reqs.get('a')?.[0]).toBe('2026-11-27');
    expect(localDate(new Date(2026, 0, 5, 0, 5).toISOString())).toBe('2026-01-05');
  });

  it('keeps no text: the result holds only the allowed fields', async () => {
    await write('a.jsonl', [
      line({ id: 'a', content: [{ type: 'tool_use', name: 'REPL', input: { code: 'SECRET WORDS' } }] }),
    ]);
    const r = await readLogFile(join(root, 'a.jsonl'));
    expect(JSON.stringify({ ...r, reqs: [...r.reqs.entries()] })).not.toContain('SECRET');
    expect(Object.keys(r).sort()).toEqual(['codeMode', 'cwd', 'firstTs', 'gitBranch', 'reqs']);
    for (const row of r.reqs.values()) {
      expect(row.filter((v) => typeof v === 'string')).toHaveLength(2);
    }
  });
});

describe('listLogFiles', () => {
  it('finds sessions and subagents with their type, and a missing root is logs-missing', async () => {
    await mkdir(join(root, 'proj', 'sess1', 'subagents'), { recursive: true });
    await write('proj/sess1.jsonl', [line({ id: 'a' })]);
    await write('proj/sess1/subagents/agent-abc.jsonl', [line({ id: 'b' })]);
    await mkdir(join(root, 'proj/sess1/subagents/workflows/wf_1'), { recursive: true });
    await write('proj/sess1/subagents/workflows/wf_1/agent-wf.jsonl', [line({ id: 'c' })]);
    await writeFile(
      join(root, 'proj/sess1/subagents/agent-abc.meta.json'),
      JSON.stringify({ agentType: 'reviewer', description: 'PRIVATE TEXT' }),
    );
    const files = await listLogFiles(root);
    const main = files.find((f) => f.kind === 'main');
    const agent = files.find((f) => f.kind === 'agent');
    expect(main?.sessionId).toBe('sess1');
    expect(agent).toMatchObject({ sessionId: 'sess1', agentId: 'agent-abc', agentType: 'reviewer' });
    expect(files.find((f) => f.agentId === 'agent-wf')?.sessionId).toBe('sess1');
    expect(JSON.stringify(files)).not.toContain('PRIVATE');
    await expect(listLogFiles(join(root, 'nope'))).rejects.toMatchObject({ code: 'logs-missing' });
    expect(new PerformanceError('read-failed').code).toBe('read-failed');
  });
});
