import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BrainArea } from '../../shared/contract.ts';
import { createBrainReaders } from './index.ts';
import { copyFixture, FIXTURE } from './test-helpers.ts';

describe('health', () => {
  it('is ok for the fixture and explains a missing brain', async () => {
    expect(await createBrainReaders(FIXTURE).health()).toEqual({ ok: true, path: FIXTURE, problems: [] });
    const bad = await createBrainReaders('/nonexistent/brain').health();
    expect(bad.ok).toBe(false);
    expect(bad.problems[0]).toBe('The brain folder was not found at /nonexistent/brain.');
  });
});

describe('watch', () => {
  it('reports a changed area once (debounced) and stops cleanly', async () => {
    const root = copyFixture();
    const brain = createBrainReaders(root);
    const seen: BrainArea[] = [];
    const stop = brain.watch((a) => seen.push(a));
    await new Promise((r) => setTimeout(r, 500)); // let the OS watcher finish starting
    mkdirSync(join(root, 'todo'), { recursive: true });
    writeFileSync(join(root, 'todo', '20261201-new.md'), 'a');
    writeFileSync(join(root, 'todo', '20261201-new.md'), 'b');
    await new Promise((r) => setTimeout(r, 1200));
    stop();
    expect(seen.filter((a) => a === 'todos')).toHaveLength(1);
    expect(() => createBrainReaders('/nonexistent/brain').watch(() => {})()).not.toThrow();
  });
});
