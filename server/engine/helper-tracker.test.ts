import { describe, expect, it } from 'vitest';
import { createHelperTracker } from './helper-tracker.ts';

const T0 = new Date('2026-11-14T10:00:00.000Z');
const T1 = new Date('2026-11-14T10:01:00.000Z');

const taskStarted = (over: Record<string, unknown> = {}) => ({
  type: 'system',
  subtype: 'task_started',
  task_id: 'task-1',
  tool_use_id: 'h1',
  description: 'Find the reports',
  task_type: 'local_agent',
  subagent_type: 'Explore',
  spawn_depth: 1,
  ...over,
});

const helperMsg = (parent: string, blocks: unknown[], model?: string) => ({
  type: 'assistant',
  message: { id: 'm', ...(model ? { model } : {}), content: blocks },
  parent_tool_use_id: parent,
});
const use = (id: string, name: string, input: Record<string, unknown> = {}) => ({
  type: 'tool_use',
  id,
  name,
  input,
});
const progress = (over: Record<string, unknown> = {}) => ({
  type: 'system',
  subtype: 'task_progress',
  task_id: 'task-1',
  tool_use_id: 'h1',
  description: 'x',
  usage: { total_tokens: 1, tool_uses: 2, duration_ms: 1 },
  ...over,
});
const toolResult = (id: string, isError = false, parent: string | null = null) => ({
  type: 'user',
  message: {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', is_error: isError }],
  },
  parent_tool_use_id: parent,
});

describe('helper tracker', () => {
  it('a hook start carries the model, tier and name of an app helper', () => {
    const t = createHelperTracker();
    t.started(
      'h1',
      { subagent_type: 'tdsapp-scout', description: "Find Acme's reports", model: 'haiku' },
      T0,
    );
    expect(t.list()).toEqual([
      {
        id: 'h1',
        name: 'Scout',
        brief: "Find Acme's reports",
        tier: 'quick',
        model: 'haiku',
        status: 'working',
        startedAt: T0.toISOString(),
        endedAt: null,
        steps: 0,
        lastStep: null,
      },
    ]);
    expect(t.workingCount()).toBe(1);
  });

  it('names other helpers "Helper (type)" or "Helper", and gives a built-in a level only when the app set its model', () => {
    const t = createHelperTracker();
    t.started('a', { subagent_type: 'Explore', model: 'haiku' }, undefined, true);
    t.started('b', { prompt: 'x' });
    t.started('c', { subagent_type: 'brain-agent', model: 'haiku' });
    t.started('d', { subagent_type: 'Explore', model: 'haiku' });
    const [a, b, c] = t.list();
    expect([a?.name, a?.tier, a?.model]).toEqual(['Helper (Explore)', 'quick', 'haiku']);
    expect([b?.name, b?.tier, b?.model]).toEqual(['Helper', null, null]);
    expect(c?.tier).toBeNull();
    // Claude chose Haiku itself: no app level.
    expect(t.list().find((h) => h.id === 'd')?.tier).toBeNull();
  });

  it('task_started for a local agent alone adds a helper, and says so', () => {
    const t = createHelperTracker();
    expect(t.observe(taskStarted(), T0)).toBe('now');
    const [h] = t.list();
    expect(h).toMatchObject({
      id: 'h1',
      name: 'Helper (Explore)',
      brief: 'Find the reports',
      status: 'working',
    });
  });

  it('ignores other task kinds, nested, ambient and parented tasks', () => {
    const t = createHelperTracker();
    for (const over of [
      { task_type: 'local_bash' },
      { task_type: undefined },
      { spawn_depth: 2 },
      { parent_task_id: 'task-0' },
      { ambient: true },
      { skip_transcript: true },
      { tool_use_id: undefined },
    ]) {
      expect(t.observe(taskStarted(over))).toBeNull();
    }
    expect(t.list()).toEqual([]);
    expect(t.observe(taskStarted({ spawn_depth: undefined }))).toBe('now');
  });

  it('a hook start and task_started for one id make one row, in either order', () => {
    const hookFirst = createHelperTracker();
    // The app gave this built-in helper its model, so it has the app's Standard level.
    hookFirst.started('h1', { subagent_type: 'Explore', description: 'Find', model: 'sonnet' }, T0, true);
    hookFirst.observe(taskStarted({ description: 'Other' }), T1);
    const taskFirst = createHelperTracker();
    taskFirst.observe(taskStarted({ description: 'Find' }), T0);
    taskFirst.started('h1', { subagent_type: 'Explore', description: 'Other', model: 'sonnet' }, T1, true);
    for (const t of [hookFirst, taskFirst]) {
      expect(t.list()).toHaveLength(1);
      expect(t.list()[0]).toMatchObject({
        brief: 'Find',
        model: 'sonnet',
        tier: 'standard',
        startedAt: T0.toISOString(),
      });
    }
  });

  it('ignores Claude Code\'s own "<synthetic>" model on an error message', () => {
    const t = createHelperTracker();
    t.started('h1', { subagent_type: 'Explore', model: 'haiku' });
    t.observe(helperMsg('h1', [{ type: 'text', text: 'API Error' }], '<synthetic>'));
    expect(t.list()[0]?.model).toBe('haiku');
  });

  it('helper assistant messages set the model id, count unique steps and set the last step', () => {
    const t = createHelperTracker();
    t.started('h1', { subagent_type: 'Explore', model: 'haiku' });
    const r1 = t.observe(
      helperMsg(
        'h1',
        [use('s1', 'Read', { file_path: '/a/b/report.md' }), use('s2', 'Grep')],
        'claude-haiku-5-5',
      ),
    );
    expect(r1).toBe('soon');
    // The same tool use seen again (a streamed copy) counts once.
    expect(t.observe(helperMsg('h1', [use('s2', 'Grep')]))).toBeNull();
    expect(t.observe(helperMsg('h1', [{ type: 'text', text: 'hi' }]))).toBeNull();
    expect(t.list()[0]).toMatchObject({ model: 'claude-haiku-5-5', steps: 2, lastStep: 'Searching files' });
    t.observe(helperMsg('h1', [use('s3', 'Read', { file_path: '/x/notes.md' })]));
    expect(t.list()[0]).toMatchObject({ steps: 3, lastStep: 'Reading notes.md' });
  });

  it('task_progress raises steps, fills a missing label, and is ignored for unknown ids', () => {
    const t = createHelperTracker();
    t.started('h1', { subagent_type: 'Explore' });
    expect(t.observe(progress({ last_tool_name: 'Bash' }))).toBe('soon');
    expect(t.list()[0]).toMatchObject({ steps: 2, lastStep: 'Running a command' });
    // Lower count, label already set: nothing changes.
    expect(
      t.observe(
        progress({ usage: { total_tokens: 1, tool_uses: 1, duration_ms: 1 }, last_tool_name: 'Read' }),
      ),
    ).toBeNull();
    expect(t.observe(progress({ tool_use_id: 'nope' }))).toBeNull();
    expect(t.list()).toHaveLength(1);
  });

  it('ignores helper messages from unknown ids and from nested helpers', () => {
    const t = createHelperTracker();
    t.started('h1', { subagent_type: 'Explore' });
    expect(t.observe(helperMsg('other', [use('s1', 'Read')]))).toBeNull();
    expect(
      t.observe({ type: 'assistant', message: { content: [use('s9', 'Read')] }, parent_tool_use_id: null }),
    ).toBeNull();
    expect(t.list()[0]?.steps).toBe(0);
  });

  it('ended: done, failed and stopped, each stamping the end time', () => {
    const t = createHelperTracker();
    for (const id of ['a', 'b', 'c', 'd']) t.started(id, { subagent_type: 'Explore' }, T0);
    t.ended('a', 'done', T1);
    t.ended('b', 'failed', T1);
    t.ended('c', 'stopped', T1);
    t.ended('unknown', 'done', T1);
    expect(t.list().map((h) => [h.status, h.endedAt])).toEqual([
      ['done', T1.toISOString()],
      ['failed', T1.toISOString()],
      ['stopped', T1.toISOString()],
      ['working', null],
    ]);
    expect(t.workingCount()).toBe(1);
  });

  it('a top-level tool_result ends a known helper; a nested one or an unknown id does not', () => {
    const t = createHelperTracker();
    t.started('a', { subagent_type: 'Explore' });
    t.started('b', { subagent_type: 'Explore' });
    expect(t.observe(toolResult('a', false, 'a'))).toBeNull();
    expect(t.observe(toolResult('zzz'))).toBeNull();
    expect(t.observe(toolResult('a'), T1)).toBe('now');
    expect(t.observe(toolResult('b', true), T1)).toBe('now');
    expect(t.list().map((h) => h.status)).toEqual(['done', 'failed']);
  });

  it('a task_notification that failed or stopped ends a known helper; a completed one does not', () => {
    const t = createHelperTracker();
    t.started('a', {});
    t.started('b', {});
    const note = (id: string, status: string) => ({
      type: 'system',
      subtype: 'task_notification',
      tool_use_id: id,
      status,
    });
    expect(t.observe(note('a', 'completed'))).toBeNull();
    expect(t.observe(note('a', 'failed'))).toBe('now');
    expect(t.observe(note('b', 'stopped'))).toBe('now');
    expect(t.list().map((h) => h.status)).toEqual(['failed', 'stopped']);
  });

  it('status never moves back, and an ended helper never changes again', () => {
    const t = createHelperTracker();
    t.started('h1', { subagent_type: 'Explore' }, T0);
    t.ended('h1', 'done', T1);
    t.ended('h1', 'failed', new Date('2026-11-14T11:00:00Z'));
    expect(t.observe(helperMsg('h1', [use('s1', 'Read')], 'claude-x'))).toBeNull();
    expect(t.observe(progress())).toBeNull();
    expect(t.observe(taskStarted(), T0)).toBeNull();
    expect(t.stopAll()).toBe(false);
    expect(t.list()[0]).toMatchObject({ status: 'done', endedAt: T1.toISOString(), steps: 0, model: null });
  });

  it('dropped removes the row', () => {
    const t = createHelperTracker();
    t.started('a', {});
    t.started('b', {});
    t.dropped('a');
    expect(t.list().map((h) => h.id)).toEqual(['b']);
  });

  it('stopAll stops every working helper and says whether any changed; clear forgets them', () => {
    const t = createHelperTracker();
    t.started('a', {}, T0);
    t.started('b', {}, T0);
    t.ended('a', 'done', T0);
    expect(t.stopAll(T1)).toBe(true);
    expect(t.list().map((h) => h.status)).toEqual(['done', 'stopped']);
    expect(t.stopAll(T1)).toBe(false);
    t.clear();
    expect(t.list()).toEqual([]);
    expect(t.workingCount()).toBe(0);
  });

  it('lists in start order as fresh copies', () => {
    const t = createHelperTracker();
    t.started('a', {});
    t.started('b', {});
    const first = t.list();
    expect(first.map((h) => h.id)).toEqual(['a', 'b']);
    const one = first[0];
    if (one) one.name = 'changed';
    expect(t.list()[0]?.name).toBe('Helper');
  });

  it('trims the brief to one line of at most 120 characters', () => {
    const t = createHelperTracker();
    t.started('a', { description: `  Line one\n\n  line   two  ` });
    t.started('b', { description: 'x'.repeat(300) });
    t.started('c', { description: 'y'.repeat(120) });
    const [a, b, c] = t.list();
    expect(a?.brief).toBe('Line one line two');
    expect(b?.brief).toHaveLength(120);
    expect(b?.brief.endsWith('…')).toBe(true);
    expect(c?.brief).toBe('y'.repeat(120));
  });

  it('observe ignores junk', () => {
    const t = createHelperTracker();
    for (const v of [null, 'x', 3, [], {}, { type: 'system' }, { type: 'user', message: 'x' }]) {
      expect(t.observe(v)).toBeNull();
    }
  });
});
