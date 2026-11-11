import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBrainReaders } from './index.ts';
import { copyFixture, person } from './test-helpers.ts';

const NOW = new Date('2026-11-11T12:00:00Z');
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function setup(lines: string[]) {
  const root = copyFixture();
  mkdirSync(join(root, 'z-logs', 'team-usage'), { recursive: true });
  writeFileSync(join(root, 'z-logs', 'team-usage', 'sam-example.jsonl'), lines.join('\n'));
  return createBrainReaders(root, { now: () => NOW });
}
const sam = person('sam-example', 'scout');

describe('usedOften', () => {
  it('counts all three line shapes and strips the slash', async () => {
    const brain = setup([
      JSON.stringify({ event: 'skill', name: 'meeting-notes', ts: day(1) }),
      JSON.stringify({ event: 'command', name: '/gm', ts: day(2) }),
      JSON.stringify({ event: 'command', name: '/gm', ts: day(3) }),
      JSON.stringify({ skill: 'meeting-notes', ts: day(4) }),
      JSON.stringify({ skill: 'trusted-audit', ts: day(5) }),
    ]);
    expect(await brain.usedOften(sam)).toEqual([
      { name: 'meeting-notes', count: 2, lastUsed: day(1) },
      { name: 'gm', count: 2, lastUsed: day(2) },
      { name: 'trusted-audit', count: 1, lastUsed: day(5) },
    ]);
  });

  it('applies the window and limit', async () => {
    const brain = setup([
      JSON.stringify({ skill: 'meeting-notes', ts: day(40) }),
      JSON.stringify({ skill: 'gm', ts: day(2) }),
      JSON.stringify({ skill: 'standup', ts: day(3) }),
    ]);
    expect((await brain.usedOften(sam)).map((u) => u.name)).toEqual(['gm', 'standup']);
    expect((await brain.usedOften(sam, { days: 90 })).map((u) => u.name)).toContain('meeting-notes');
    expect(await brain.usedOften(sam, { limit: 1 })).toHaveLength(1);
  });

  it('keeps only skills this person may see', async () => {
    const brain = setup([
      JSON.stringify({ skill: 'admin-setup', ts: day(1) }),
      JSON.stringify({ skill: 'not-a-skill', ts: day(1) }),
      JSON.stringify({ skill: 'gm', ts: day(1) }),
    ]);
    expect((await brain.usedOften(person('sam-example', 'team'))).map((u) => u.name)).toEqual(['gm']);
  });

  it('ignores bad lines, other events and a missing file', async () => {
    const brain = setup([
      'not json',
      '',
      `{"event":"hook","name":"x","ts":"${day(1)}"}`,
      '{"skill":"gm"}',
      '[1]',
      JSON.stringify({ skill: 'gm', ts: day(1) }),
    ]);
    expect(await brain.usedOften(sam)).toEqual([{ name: 'gm', count: 1, lastUsed: day(1) }]);
    expect(await brain.usedOften(person('nobody-here', 'scout'))).toEqual([]);
  });
});
